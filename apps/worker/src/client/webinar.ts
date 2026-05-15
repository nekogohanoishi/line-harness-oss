// LIFF Webinar viewing page — 擬似ライブ配信プレイヤー。
//
// Bootstrap entry: client/main.ts → ?page=webinar&id=<bookingId>
//   1. /api/liff/webinar/:bookingId/manifest を取得
//   2. server_now_ts と slot.starts_at から clock skew を計算
//   3. access_state に応じて画面を切替:
//      - pre_start: カウントダウン
//      - live:      動画を currentTime=elapsed にシークして再生 (シーク禁止)
//      - replay:    通常コントロール有効
//      - expired:   archive_url にリダイレクト or 終了画面
//   4. timeupdate で CTA を at_seconds と比較し表示
//   5. 30s ごとに heartbeat POST、完視聴判定で /completed POST
//
// 設計書: docs/specs/2026-05-14-webinar-launch-design.md §6
// LIFF SDK は client/main.ts と同じ window.liff を流用。

declare const liff: {
  init(config: { liffId: string }): Promise<void>;
  isLoggedIn(): boolean;
  login(opts?: { redirectUri?: string }): void;
  getProfile(): Promise<{ userId: string; displayName: string; pictureUrl?: string }>;
  getIDToken(): string | null;
  isInClient(): boolean;
  closeWindow(): void;
};

// ===========================================================
// Types
// ===========================================================

type AccessState = 'pre_start' | 'live' | 'replay' | 'expired';

interface CtaItem {
  id: string;
  at_seconds: number;
  display_mode: 'banner' | 'modal' | 'sticky';
  label: string;
  action_type: 'url' | 'tag' | 'tracked_link' | 'close';
  action_value: string | null;
  dismiss_after_seconds: number | null;
  sort_order: number;
}

// Phase 7b: コメント風固定表示 (fake comments)
interface FakeCommentItem {
  id: string;
  at_seconds: number;
  author_name: string;
  body: string;
  author_color: string | null;
  sort_order: number;
}

interface Manifest {
  booking: {
    id: string;
    first_opened_at: string | null;
    video_started_at: string | null;
    max_position_seconds: number;
    completed_at: string | null;
    last_heartbeat_at: string | null;
  };
  event: {
    id: string;
    kind: string;
    name: string;
    image_url: string | null;
    description: string | null;
    attendance_threshold_seconds: number | null;
    replay_window_minutes: number | null;
    archive_url: string | null;
  };
  video: {
    duration_seconds: number | null;
    mime_type: string | null;
    stream_url: string;
  };
  slot: { starts_at: string; ends_at: string };
  access_state: AccessState;
  server_now_ts: number;
  ctas: CtaItem[];
  // Phase 7: ライブ感演出
  live_feel?: {
    show_concurrent_viewers: boolean;
    show_fake_comments: boolean;
  };
  fake_comments?: FakeCommentItem[];
}

interface Ctx {
  bookingId: string;
  idToken: string;
}

const HEARTBEAT_INTERVAL_MS = 30_000;
const STATE_TICK_MS = 1000;
const DRIFT_RESYNC_THRESHOLD_SEC = 3;
// Phase 7a: 同接視聴者数 polling 間隔. Worker CPU を抑えるため 30s 固定.
const CONCURRENT_POLL_INTERVAL_MS = 30_000;
// Phase 7b: コメント縦並びの最大件数. これを超えたら古い順に fade-out.
const FAKE_COMMENT_MAX_VISIBLE = 10;
// Phase 7b: コメントを fade-out させずに保持する秒数 (実時間, 動画位置とは別軸).
const FAKE_COMMENT_AUTO_DISMISS_MS = 12_000;

function escapeHtml(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// ===========================================================
// Page entry
// ===========================================================

export async function initWebinar(ctx: { liffId: string; idToken: string; bookingId: string }): Promise<void> {
  const container = document.getElementById('app');
  if (!container) return;
  if (!ctx.bookingId) {
    renderError(container, '視聴 ID が指定されていません');
    return;
  }
  const headers = { Authorization: `Bearer ${ctx.idToken}` };

  renderLoading(container);

  let manifest: Manifest;
  try {
    const res = await fetch(`/api/liff/webinar/${encodeURIComponent(ctx.bookingId)}/manifest`, {
      headers,
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(err?.error ?? `HTTP ${res.status}`);
    }
    manifest = (await res.json()) as Manifest;
  } catch (e) {
    renderError(container, `視聴データの取得に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }

  // 初回 open イベント (best-effort)
  fetch(`/api/liff/webinar/${encodeURIComponent(ctx.bookingId)}/event/opened`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: '{}',
  }).catch(() => {});

  // 期限切れ: archive_url にリダイレクト or 終了表示
  if (manifest.access_state === 'expired') {
    if (manifest.event.archive_url) {
      window.location.href = manifest.event.archive_url;
      return;
    }
    renderExpired(container, manifest);
    return;
  }

  renderShell(container, manifest);
  startPlayer(container, manifest, { bookingId: ctx.bookingId, idToken: ctx.idToken });
}

// ===========================================================
// Render: shell
// ===========================================================

function renderLoading(container: HTMLElement): void {
  container.innerHTML = `
    <div class="webinar-card">
      <div class="loading-spinner"></div>
      <p class="message">読み込み中...</p>
    </div>
  `;
}

function renderError(container: HTMLElement, message: string): void {
  container.innerHTML = `
    <div class="webinar-card">
      <h2>エラー</h2>
      <p class="error">${escapeHtml(message)}</p>
    </div>
  `;
}

function renderExpired(container: HTMLElement, m: Manifest): void {
  container.innerHTML = `
    <div class="webinar-card">
      <h2>${escapeHtml(m.event.name)}</h2>
      <p class="message">このセミナーの視聴期間は終了しました。</p>
    </div>
  `;
}

function renderShell(container: HTMLElement, m: Manifest): void {
  const hasVideo = !!m.video.duration_seconds && !!m.video.stream_url;
  container.innerHTML = `
    <div class="webinar-page">
      <div class="webinar-head">
        <h1>${escapeHtml(m.event.name)}</h1>
      </div>
      <div class="webinar-stage">
        <div class="webinar-countdown" data-role="countdown" hidden>
          <p class="cd-label">配信開始まで</p>
          <p class="cd-value" data-role="countdown-value">--:--:--</p>
        </div>
        <div class="webinar-video-wrap" data-role="video-wrap" hidden>
          <video
            data-role="video"
            playsinline
            preload="metadata"
            ${hasVideo ? '' : 'hidden'}
          ></video>
          <div class="webinar-progress" data-role="progress" hidden>
            <div class="webinar-progress-bar" data-role="progress-bar"></div>
          </div>
          <div class="webinar-play-overlay" data-role="play-overlay" hidden>
            <button class="webinar-play-btn" data-role="play-btn">▶ 視聴を開始する</button>
            <p class="webinar-play-hint">タップして再生（iOS の自動再生制限のため）</p>
          </div>
          <div class="webinar-concurrent" data-role="concurrent" hidden>
            <span class="webinar-concurrent-icon">👥</span>
            <span class="webinar-concurrent-count" data-role="concurrent-count">--</span>
            <span class="webinar-concurrent-label">人が視聴中</span>
          </div>
          <div class="webinar-fake-comments" data-role="fake-comments" hidden></div>
        </div>
      </div>
      <div class="webinar-cta-banner" data-role="cta-banner" hidden></div>
      <div class="webinar-cta-sticky" data-role="cta-sticky" hidden></div>
      <div class="webinar-modal" data-role="cta-modal" hidden>
        <div class="webinar-modal-backdrop" data-role="modal-backdrop"></div>
        <div class="webinar-modal-body" data-role="modal-body"></div>
      </div>
      ${m.event.description ? `<div class="webinar-description">${escapeHtml(m.event.description)}</div>` : ''}
    </div>
  `;
}

// ===========================================================
// Player + state machine
// ===========================================================

interface PlayerHandles {
  videoEl: HTMLVideoElement | null;
  countdownEl: HTMLElement | null;
  countdownValueEl: HTMLElement | null;
  videoWrapEl: HTMLElement | null;
  playOverlayEl: HTMLElement | null;
  playBtn: HTMLButtonElement | null;
  progressBarEl: HTMLElement | null;
  progressEl: HTMLElement | null;
  ctaBannerEl: HTMLElement | null;
  ctaStickyEl: HTMLElement | null;
  ctaModalEl: HTMLElement | null;
  ctaModalBodyEl: HTMLElement | null;
  modalBackdropEl: HTMLElement | null;
  // Phase 7a: 同接視聴者数
  concurrentEl: HTMLElement | null;
  concurrentCountEl: HTMLElement | null;
  // Phase 7b: コメント風固定表示
  fakeCommentsEl: HTMLElement | null;
}

function startPlayer(container: HTMLElement, manifest: Manifest, ctx: Ctx): void {
  const h: PlayerHandles = {
    videoEl: container.querySelector('[data-role="video"]'),
    countdownEl: container.querySelector('[data-role="countdown"]'),
    countdownValueEl: container.querySelector('[data-role="countdown-value"]'),
    videoWrapEl: container.querySelector('[data-role="video-wrap"]'),
    playOverlayEl: container.querySelector('[data-role="play-overlay"]'),
    playBtn: container.querySelector('[data-role="play-btn"]'),
    progressBarEl: container.querySelector('[data-role="progress-bar"]'),
    progressEl: container.querySelector('[data-role="progress"]'),
    ctaBannerEl: container.querySelector('[data-role="cta-banner"]'),
    ctaStickyEl: container.querySelector('[data-role="cta-sticky"]'),
    ctaModalEl: container.querySelector('[data-role="cta-modal"]'),
    ctaModalBodyEl: container.querySelector('[data-role="modal-body"]'),
    modalBackdropEl: container.querySelector('[data-role="modal-backdrop"]'),
    concurrentEl: container.querySelector('[data-role="concurrent"]'),
    concurrentCountEl: container.querySelector('[data-role="concurrent-count"]'),
    fakeCommentsEl: container.querySelector('[data-role="fake-comments"]'),
  };

  const slotStartMs = new Date(manifest.slot.starts_at).getTime();
  const clockSkewMs = Date.now() - manifest.server_now_ts;
  const duration = manifest.video.duration_seconds ?? 0;
  const replayWindowMs = (manifest.event.replay_window_minutes ?? 0) * 60_000;
  const threshold =
    manifest.event.attendance_threshold_seconds ?? Math.floor(duration * 0.8);

  // Hydrate video.src — 認証ヘッダーが必要なので fetch+blob ではなく <video src> に
  // 直接渡すと Authorization header を載せられない。実装メモ: LIFF は同一 origin
  // で Worker が ID token を Cookie で受け取らない仕様のため、stream URL に
  // id_token を query param で渡すと verifyCallerLineUserId が effect を持たない
  // (verifyCallerLineUserId は Authorization header のみ参照)。
  //
  // 解決策: <video src> 経由のリクエストには Authorization ヘッダーを付けられない
  // ので、stream エンドポイントを「ID token を ?id_token= query で受け取る」よう
  // 拡張するか、Worker 側で session cookie を発行する必要がある。v1 では query
  // param を許容する経路を追加するのが妥当だが、scope 縮小のため、まずは
  // Authorization ヘッダー必須の仕様で <video> 表示は LIFF SDK の id_token を
  // URL 短期付与で代用する方針とし、実環境テストの結果次第で経路を切り替える。
  //
  // Implementation note: 短期的なつなぎとして、authorize() で得た id_token を
  // stream URL の ?_t= query に乗せる経路は Worker 側で別途検討要 (TODO)。
  if (h.videoEl && manifest.video.stream_url) {
    const sep = manifest.video.stream_url.includes('?') ? '&' : '?';
    // ID token を query で渡す前提のフォールバック。verifyCallerLineUserId は
    // 現状 query を見ないので production 動作には Worker 側追加対応が必要。
    h.videoEl.src = `${manifest.video.stream_url}${sep}_t=${encodeURIComponent(ctx.idToken)}`;
  }

  let userHasInteracted = false;
  const shownCtas = new Set<string>();
  let hbTimer: number | null = null;
  let stateTimer: number | null = null;
  let concurrentTimer: number | null = null;
  let lastReportedPos = 0;
  let completedReported = !!manifest.booking.completed_at;
  let startedReported = !!manifest.booking.video_started_at;

  // Phase 7b: fake_comments の表示状態。
  //  - shownFakeComments: 既に流したコメント ID (二重表示防止)
  //  - lastSeenPosSec: ontimeupdate で前回処理した秒. 戻った/シークされたら再
  //    投入はしない (同じコメントが何度も流れないように).
  const shownFakeComments = new Set<string>();
  let lastSeenPosSec = -1;
  // sort by at_seconds で安定ソート (本来 manifest 側でソート済み)
  const fakeCommentsSorted: FakeCommentItem[] = (manifest.fake_comments ?? [])
    .slice()
    .sort((a, b) =>
      a.at_seconds !== b.at_seconds ? a.at_seconds - b.at_seconds : a.sort_order - b.sort_order,
    );
  const showFakeComments = manifest.live_feel?.show_fake_comments === true;
  const showConcurrent = manifest.live_feel?.show_concurrent_viewers === true;

  function show(el: HTMLElement | null): void {
    if (el) el.hidden = false;
  }
  function hide(el: HTMLElement | null): void {
    if (el) el.hidden = true;
  }

  function setLiveMode(): void {
    if (!h.videoEl) return;
    h.videoEl.controls = false;
    h.videoEl.disablePictureInPicture = true;
    show(h.progressEl);
  }
  function setReplayMode(): void {
    if (!h.videoEl) return;
    h.videoEl.controls = true;
    hide(h.progressEl);
  }

  function setCountdownVisible(remainingMs: number): void {
    show(h.countdownEl);
    hide(h.videoWrapEl);
    if (h.countdownValueEl) {
      const totalSec = Math.max(0, Math.floor(remainingMs / 1000));
      const hh = Math.floor(totalSec / 3600);
      const mm = Math.floor((totalSec % 3600) / 60);
      const ss = totalSec % 60;
      h.countdownValueEl.textContent =
        `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
    }
  }

  function showVideoStage(): void {
    hide(h.countdownEl);
    show(h.videoWrapEl);
  }

  function showCta(cta: CtaItem): void {
    if (shownCtas.has(cta.id)) return;
    shownCtas.add(cta.id);

    if (cta.display_mode === 'modal') {
      if (h.ctaModalBodyEl && h.ctaModalEl) {
        h.ctaModalBodyEl.innerHTML = `
          <p class="webinar-modal-label">${escapeHtml(cta.label)}</p>
          <button class="webinar-cta-action" type="button">${escapeHtml(cta.label)}</button>
          <button class="webinar-modal-close" type="button">閉じる</button>
        `;
        show(h.ctaModalEl);
        const actionBtn = h.ctaModalBodyEl.querySelector(
          '.webinar-cta-action',
        ) as HTMLButtonElement | null;
        const closeBtn = h.ctaModalBodyEl.querySelector(
          '.webinar-modal-close',
        ) as HTMLButtonElement | null;
        actionBtn?.addEventListener('click', () => triggerCta(cta));
        closeBtn?.addEventListener('click', () => hide(h.ctaModalEl));
        h.modalBackdropEl?.addEventListener('click', () => hide(h.ctaModalEl), { once: true });
      }
    } else if (cta.display_mode === 'banner') {
      if (h.ctaBannerEl) {
        h.ctaBannerEl.innerHTML = `
          <button class="webinar-cta-action" type="button">${escapeHtml(cta.label)}</button>
          <button class="webinar-cta-dismiss" type="button" aria-label="閉じる">×</button>
        `;
        show(h.ctaBannerEl);
        h.ctaBannerEl.querySelector('.webinar-cta-action')?.addEventListener('click', () => triggerCta(cta));
        h.ctaBannerEl.querySelector('.webinar-cta-dismiss')?.addEventListener('click', () => hide(h.ctaBannerEl));
      }
    } else {
      // sticky
      if (h.ctaStickyEl) {
        h.ctaStickyEl.innerHTML = `
          <button class="webinar-cta-action" type="button">${escapeHtml(cta.label)}</button>
        `;
        show(h.ctaStickyEl);
        h.ctaStickyEl.querySelector('.webinar-cta-action')?.addEventListener('click', () => triggerCta(cta));
      }
    }

    if (cta.dismiss_after_seconds && cta.dismiss_after_seconds > 0) {
      window.setTimeout(() => {
        if (cta.display_mode === 'modal') hide(h.ctaModalEl);
        else if (cta.display_mode === 'banner') hide(h.ctaBannerEl);
        else hide(h.ctaStickyEl);
      }, cta.dismiss_after_seconds * 1000);
    }
  }

  function triggerCta(cta: CtaItem): void {
    const pos = h.videoEl ? Math.floor(h.videoEl.currentTime) : 0;
    // Phase 6b: Worker 側でカート期間に応じた redirect_url を返すので、それを尊重する。
    // レスポンスを待ってから window.open すると LINE 内で popup ブロックされる端末が
    // あるため、本物の URL は先に開く準備 (preliminary open) してから差し替える方が
    // 安全だが、簡素化のため fetch を await した上で開く。LIFF 内ブラウザは popup 制限が
    // 厳しくないため動作する。
    if (cta.action_type === 'close') {
      void fetch(`/api/liff/webinar/${encodeURIComponent(ctx.bookingId)}/event/cta-click`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ctx.idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ctaItemId: cta.id, positionSeconds: pos }),
      }).catch(() => {});
      if (typeof liff !== 'undefined' && liff.isInClient && liff.isInClient()) {
        try {
          liff.closeWindow();
        } catch {
          /* silent */
        }
      }
      return;
    }
    if (cta.action_type === 'url' || cta.action_type === 'tracked_link') {
      // カート切替判定は Worker 側 (cart_relative_close_minutes が設定された event のみ)
      fetch(`/api/liff/webinar/${encodeURIComponent(ctx.bookingId)}/event/cta-click`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ctx.idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ctaItemId: cta.id, positionSeconds: pos }),
      })
        .then((r) => r.ok ? r.json() as Promise<{ redirect_url: string | null }> : null)
        .then((json) => {
          const url = json?.redirect_url ?? cta.action_value;
          if (url) window.open(url, '_blank');
        })
        .catch(() => {
          if (cta.action_value) window.open(cta.action_value, '_blank');
        });
      return;
    }
    // tag etc. は別 endpoint 経由 (TODO: タグ付与の同期 API は v2)
    fetch(`/api/liff/webinar/${encodeURIComponent(ctx.bookingId)}/event/cta-click`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ctx.idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ctaItemId: cta.id, positionSeconds: pos }),
    }).catch(() => {});
  }

  function fireStarted(): void {
    if (startedReported) return;
    startedReported = true;
    fetch(`/api/liff/webinar/${encodeURIComponent(ctx.bookingId)}/event/started`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ctx.idToken}`, 'Content-Type': 'application/json' },
      body: '{}',
    }).catch(() => {});
  }

  function fireHeartbeat(): void {
    if (!h.videoEl) return;
    const pos = Math.floor(h.videoEl.currentTime);
    if (pos <= lastReportedPos && pos < 5) return;
    lastReportedPos = pos;
    fetch(`/api/liff/webinar/${encodeURIComponent(ctx.bookingId)}/event/heartbeat`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ctx.idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ positionSeconds: pos }),
    }).catch(() => {});
  }

  // Phase 7b: コメント風表示
  function colorForAuthor(name: string, override: string | null): string {
    if (override) return override;
    // ハッシュベースで HSL を生成 (安定 + パステル).
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
    const hue = Math.abs(h) % 360;
    return `hsl(${hue}, 70%, 55%)`;
  }
  function injectFakeComment(cm: FakeCommentItem): void {
    if (!h.fakeCommentsEl) return;
    if (shownFakeComments.has(cm.id)) return;
    shownFakeComments.add(cm.id);
    show(h.fakeCommentsEl);
    const row = document.createElement('div');
    row.className = 'webinar-fake-comment';
    const color = colorForAuthor(cm.author_name, cm.author_color);
    row.innerHTML = `
      <span class="webinar-fake-comment-avatar" style="background:${escapeHtml(color)}">${escapeHtml(
        cm.author_name.slice(0, 1),
      )}</span>
      <span class="webinar-fake-comment-name">${escapeHtml(cm.author_name)}</span>
      <span class="webinar-fake-comment-body">${escapeHtml(cm.body)}</span>
    `;
    h.fakeCommentsEl.appendChild(row);
    // 最大件数を超えたら古い行を fade-out して削除
    while (h.fakeCommentsEl.children.length > FAKE_COMMENT_MAX_VISIBLE) {
      const first = h.fakeCommentsEl.firstElementChild;
      if (!first) break;
      first.remove();
    }
    // 自動 dismiss (時間経過で fade-out)
    window.setTimeout(() => {
      row.classList.add('webinar-fake-comment-fade');
      window.setTimeout(() => row.remove(), 600);
    }, FAKE_COMMENT_AUTO_DISMISS_MS);
  }
  function handleFakeCommentsAtPosition(pos: number): void {
    if (!showFakeComments || fakeCommentsSorted.length === 0) return;
    // 戻った/シークされた場合は再投入しない (lastSeenPosSec を進めるだけ).
    // ただし最初の tick (lastSeenPosSec === -1) は当該 pos までを全部投入する.
    if (lastSeenPosSec >= 0 && pos < lastSeenPosSec) {
      lastSeenPosSec = pos;
      return;
    }
    for (const cm of fakeCommentsSorted) {
      if (cm.at_seconds <= pos && !shownFakeComments.has(cm.id)) {
        injectFakeComment(cm);
      }
    }
    lastSeenPosSec = pos;
  }

  // Phase 7a: 同接視聴者数 polling
  function pollConcurrent(): void {
    if (!showConcurrent) return;
    fetch(`/api/liff/webinar/${encodeURIComponent(ctx.bookingId)}/concurrent`, {
      headers: { Authorization: `Bearer ${ctx.idToken}` },
    })
      .then((r) => (r.ok ? (r.json() as Promise<{ count: number }>) : null))
      .then((json) => {
        if (!json || !h.concurrentCountEl || !h.concurrentEl) return;
        h.concurrentCountEl.textContent = String(json.count);
        show(h.concurrentEl);
      })
      .catch(() => {
        // 失敗は無視 (LIFF ペイロード軽量化のため hide のままで OK)
      });
  }

  function fireCompleted(): void {
    if (completedReported) return;
    completedReported = true;
    fetch(`/api/liff/webinar/${encodeURIComponent(ctx.bookingId)}/event/completed`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ctx.idToken}`, 'Content-Type': 'application/json' },
      body: '{}',
    }).catch(() => {});
  }

  // CTA timeupdate
  if (h.videoEl) {
    h.videoEl.addEventListener('timeupdate', () => {
      if (!h.videoEl) return;
      const pos = Math.floor(h.videoEl.currentTime);
      // progress bar
      if (duration > 0 && h.progressBarEl) {
        h.progressBarEl.style.width = `${Math.min(100, (pos / duration) * 100)}%`;
      }
      for (const cta of manifest.ctas) {
        if (pos >= cta.at_seconds && !shownCtas.has(cta.id)) showCta(cta);
      }
      handleFakeCommentsAtPosition(pos);
      if (!completedReported && threshold > 0 && pos >= threshold) {
        fireCompleted();
      }
    });

    h.videoEl.addEventListener('play', fireStarted);

    // ライブモード中は seek 禁止 (シーク試行を即時に戻す)
    h.videoEl.addEventListener('seeking', () => {
      const mode = currentMode();
      if (mode !== 'live') return;
      const trueNow = Date.now() - clockSkewMs;
      const elapsedSec = (trueNow - slotStartMs) / 1000;
      if (h.videoEl && Math.abs(h.videoEl.currentTime - elapsedSec) > DRIFT_RESYNC_THRESHOLD_SEC) {
        h.videoEl.currentTime = Math.max(0, elapsedSec);
      }
    });
  }

  function currentMode(): AccessState {
    const trueNow = Date.now() - clockSkewMs;
    const elapsedMs = trueNow - slotStartMs;
    if (elapsedMs < 0) return 'pre_start';
    if (elapsedMs < duration * 1000) return 'live';
    if (elapsedMs < duration * 1000 + replayWindowMs) return 'replay';
    return 'expired';
  }

  // Play 開始ボタン (iOS autoplay 制限の escape)
  if (h.playBtn) {
    h.playBtn.addEventListener('click', () => {
      userHasInteracted = true;
      hide(h.playOverlayEl);
      const mode = currentMode();
      if (mode === 'live' && h.videoEl) {
        const trueNow = Date.now() - clockSkewMs;
        const elapsedSec = (trueNow - slotStartMs) / 1000;
        h.videoEl.currentTime = Math.max(0, elapsedSec);
      }
      h.videoEl?.play().catch(() => {
        // 再生失敗時はオーバーレイ再表示
        show(h.playOverlayEl);
      });
    });
  }

  // Main tick (設計書 §6.2)
  function tick(): void {
    const trueNow = Date.now() - clockSkewMs;
    const elapsedMs = trueNow - slotStartMs;
    const mode = currentMode();

    if (mode === 'pre_start') {
      setCountdownVisible(-elapsedMs);
      hide(h.playOverlayEl);
      // Phase 7: pre_start では live-feel オーバーレイは非表示
      hide(h.concurrentEl);
      hide(h.fakeCommentsEl);
      return;
    }

    showVideoStage();

    if (mode === 'expired') {
      // tick 中に expired に遷移したら archive へ
      if (manifest.event.archive_url) {
        window.location.href = manifest.event.archive_url;
      } else {
        renderExpired(container, manifest);
        stop();
      }
      return;
    }

    if (mode === 'live') {
      setLiveMode();
      // Phase 7a: 同接表示はライブモードでのみ。 replay モードでは hide.
      if (showConcurrent && h.concurrentCountEl?.textContent !== '--') {
        show(h.concurrentEl);
      }
      if (!h.videoEl) return;
      const elapsedSec = elapsedMs / 1000;
      if (h.videoEl.paused) {
        if (userHasInteracted) {
          h.videoEl.currentTime = Math.max(0, elapsedSec);
          h.videoEl.play().catch(() => {
            show(h.playOverlayEl);
          });
        } else {
          show(h.playOverlayEl);
        }
      } else if (Math.abs(h.videoEl.currentTime - elapsedSec) > DRIFT_RESYNC_THRESHOLD_SEC) {
        // drift 補正
        h.videoEl.currentTime = elapsedSec;
      }
    } else {
      // replay
      setReplayMode();
      // Phase 7a: replay では同接非表示 (擬似ライブ感の都合)
      hide(h.concurrentEl);
      if (h.videoEl && h.videoEl.paused && !userHasInteracted) {
        show(h.playOverlayEl);
      }
    }
  }

  function stop(): void {
    if (hbTimer) {
      clearInterval(hbTimer);
      hbTimer = null;
    }
    if (stateTimer) {
      clearInterval(stateTimer);
      stateTimer = null;
    }
    if (concurrentTimer) {
      clearInterval(concurrentTimer);
      concurrentTimer = null;
    }
  }

  stateTimer = window.setInterval(tick, STATE_TICK_MS);
  hbTimer = window.setInterval(fireHeartbeat, HEARTBEAT_INTERVAL_MS);
  // Phase 7a: 同接表示。ライブ・リプレイ両方で動かし、pre_start / expired で
  // tick() 側が hide する。最初の値は manifest 取得直後に拾う。
  if (showConcurrent) {
    pollConcurrent();
    concurrentTimer = window.setInterval(pollConcurrent, CONCURRENT_POLL_INTERVAL_MS);
  }
  tick();
}
