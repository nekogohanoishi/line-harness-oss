import { enrollFriendInScenario, getScenarios } from '@line-crm/db';

/**
 * タグが付いたときに始まる設定 (trigger_type = 'tag_added') のシナリオへ、
 * まだ入っていなければ友だちを登録する。管理画面からの手動タグ付けと、
 * メッセージのボタンでのタグ付けの両方から呼ぶ。
 */
export async function enrollTagTriggeredScenarios(db: D1Database, friendId: string, tagId: string): Promise<void> {
  const allScenarios = await getScenarios(db);
  for (const scenario of allScenarios) {
    if (scenario.trigger_type === 'tag_added' && scenario.is_active && scenario.trigger_tag_id === tagId) {
      const existing = await db
        .prepare(`SELECT id FROM friend_scenarios WHERE friend_id = ? AND scenario_id = ?`)
        .bind(friendId, scenario.id)
        .first();
      if (!existing) {
        await enrollFriendInScenario(db, friendId, scenario.id);
      }
    }
  }
}
