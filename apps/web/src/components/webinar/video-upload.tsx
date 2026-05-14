'use client'

// Webinar Launch (migration 041): 動画アップロード UI。
// アップロードフロー (設計書 §9.2 と routes/webinar.ts 実装):
//   1. <input type="file"> でファイル選択 → HTMLVideoElement で duration を取得
//   2. webinarApi.requestVideoUpload → uploadUrl/key を取得
//   3. XMLHttpRequest.PUT(uploadUrl, File) を発火し progress を表示
//      (fetch では upload progress event を取れないため XHR を使う)
//   4. webinarApi.finalizeVideo({ durationSeconds, sizeBytes, mimeType, key })
//   5. 親に updated EventListItem を渡して再描画
//
// 既存アップロード済みの状態では、メタ情報 + 削除/プレビューボタンを表示。

import { useRef, useState } from 'react'
import { webinarApi, type EventDetail, type EventListItem } from '@/lib/api'

interface Props {
  accountId: string
  eventId: string
  event: EventDetail
  // 親 (event-form.tsx の setDraft) に新しい event row を伝える。
  onEventUpdated: (next: EventListItem) => void
}

function bytesToHuman(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function secondsToMmSs(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const mm = Math.floor(s / 60)
  const ss = s % 60
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

// 動画ファイルから duration メタを取得。
function probeVideoMetadata(file: File): Promise<{ duration: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.src = url
    video.onloadedmetadata = () => {
      const d = video.duration
      URL.revokeObjectURL(url)
      if (!Number.isFinite(d) || d <= 0) reject(new Error('動画の duration が読み取れません'))
      else resolve({ duration: d })
    }
    video.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('動画ファイルを読み取れません'))
    }
  })
}

// XHR で PUT して上り progress を流す。
async function putWithProgress(
  uploadUrl: string,
  file: File,
  headers: Record<string, string>,
  onProgress: (pct: number) => void,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', uploadUrl, true)
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress((e.loaded / e.total) * 100)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else reject(new Error(`upload failed: ${xhr.status}`))
    }
    xhr.onerror = () => reject(new Error('upload network error'))
    xhr.send(file)
  })
}

export default function VideoUpload({ accountId, eventId, event, onEventUpdated }: Props) {
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const hasVideo = !!event.video_r2_key

  async function handleFile(file: File) {
    setError(null)
    setProgress(0)
    setUploading(true)
    try {
      const { duration } = await probeVideoMetadata(file)
      const upload = await webinarApi.requestVideoUpload(eventId, accountId, {
        mimeType: file.type || 'video/mp4',
        sizeBytes: file.size,
      })
      await putWithProgress(upload.upload_url, file, upload.headers, setProgress)
      const updated = await webinarApi.finalizeVideo(eventId, accountId, {
        durationSeconds: Math.floor(duration),
        sizeBytes: file.size,
        mimeType: file.type || 'video/mp4',
        key: upload.r2_key,
      })
      onEventUpdated(updated)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setUploading(false)
      setProgress(0)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handleDelete() {
    if (!confirm('動画を削除しますか？視聴者は動画にアクセスできなくなります。')) return
    setUploading(true)
    setError(null)
    try {
      await webinarApi.deleteVideo(eventId, accountId)
      // delete は EventListItem を返さないので、ローカル EventDetail を
      // null クリアで再構成 (event-form 側で再 fetch しても良いが負荷を避ける)
      onEventUpdated({
        ...(event as unknown as EventListItem),
        video_r2_key: null,
        video_duration_seconds: null,
        video_mime_type: null,
        video_size_bytes: null,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="border border-gray-200 rounded-lg p-4">
      <div className="text-sm font-medium text-gray-700 mb-3">配信動画</div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-2 rounded-lg mb-3 text-sm">{error}</div>
      )}

      {uploading ? (
        <div>
          <div className="text-sm text-gray-600 mb-2">アップロード中... {progress.toFixed(0)}%</div>
          <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
            <div
              className="bg-blue-600 h-2 transition-all"
              style={{ width: `${Math.max(2, progress)}%` }}
            />
          </div>
        </div>
      ) : hasVideo ? (
        <div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-3">
            <div>
              <div className="text-xs text-gray-500">尺</div>
              <div className="font-mono text-gray-800">
                {event.video_duration_seconds != null
                  ? `${secondsToMmSs(event.video_duration_seconds)} (${event.video_duration_seconds}s)`
                  : '-'}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-500">サイズ</div>
              <div className="text-gray-800">
                {event.video_size_bytes != null ? bytesToHuman(event.video_size_bytes) : '-'}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-500">MIME</div>
              <div className="text-gray-800 font-mono">{event.video_mime_type ?? '-'}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">R2 key</div>
              <div className="text-gray-800 font-mono text-[10px] truncate" title={event.video_r2_key ?? ''}>
                {event.video_r2_key ?? '-'}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPreviewing((v) => !v)}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              {previewing ? 'プレビューを閉じる' : 'プレビュー再生'}
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              差し替え (再アップロード)
            </button>
            <button
              type="button"
              onClick={handleDelete}
              className="px-3 py-1.5 text-sm text-red-700 border border-red-200 rounded-lg hover:bg-red-50 ml-auto"
            >
              動画を削除
            </button>
          </div>
          {previewing && (
            <div className="mt-3 text-xs text-gray-500">
              プレビューは Worker proxy で LIFF 認証必須のため admin UI からは直接再生できません。
              実機 LIFF / 友だちアカでの確認をおすすめします。
            </div>
          )}
        </div>
      ) : (
        <div>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            動画ファイルを選択
          </button>
          <p className="text-xs text-gray-500 mt-2">
            mp4 / webm / mov / ogg, 上限 2GB。アップロード後に CTA タイムラインを編集できます。
          </p>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void handleFile(f)
        }}
      />
    </div>
  )
}
