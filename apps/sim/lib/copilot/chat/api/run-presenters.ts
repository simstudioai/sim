import type { V2ChatRunSummary } from '@/lib/api/contracts/v2/chat-runs'
import type { PublicChatRunRow } from '@/lib/copilot/chat/public-runs'

export function toPublicChatRunSummary(row: PublicChatRunRow): V2ChatRunSummary {
  return {
    runId: row.runId,
    chatId: row.chatId,
    chatTitle: row.chatTitle,
    status: row.status,
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  }
}
