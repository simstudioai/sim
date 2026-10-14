import { isPlainRecord } from '@sim/utils/object'
import { truncate } from '@sim/utils/string'
import type { DesktopInboxRow } from '@/lib/desktop/executor/repository'
import { ASYNC_TOOL_STATUS, isAwaitingToolPermission } from '@/lib/mothership/async-runs/lifecycle'
import { isBackgroundDesktopToolCall } from '@/lib/mothership/tools/desktop-tools'

const SUMMARY_MAX_LENGTH = 200

/** Something the device should act on, derived from the durable rows on every read. */
export type DesktopInboxEntry =
  | {
      kind: 'call'
      toolCallId: string
      toolName: string
      chatId: string
      workspaceId: string | null
      createdAt: Date
    }
  | {
      kind: 'approval_needed'
      toolCallId: string
      toolName: string
      chatId: string
      chatTitle: string | null
      workspaceId: string | null
      summary: string | null
    }
  | { kind: 'cancel'; toolCallId: string }

/** The command a gated terminal run would execute: `{ operation: 'run', args: { command } }`. */
function summarize(args: Record<string, unknown>): string | null {
  const command = isPlainRecord(args.args) ? args.args.command : undefined
  return typeof command === 'string' && command.trim()
    ? truncate(command.trim(), SUMMARY_MAX_LENGTH)
    : null
}

/**
 * Classifies inbox rows:
 * - `call`: pending and free to run, so the device may claim it.
 * - `approval_needed`: held for the user's decision, so the device can notify; it becomes a
 *   `call` once allowed, and leaves the inbox if declined.
 * - `cancel`: a call the device claimed that Sim settled without its result (Stop, a lost lease).
 *   It stays listed until the device posts a result for it, which acknowledges the cancellation.
 * A call the device is running normally is not listed: the device already holds it.
 */
export function classifyDesktopInbox(rows: DesktopInboxRow[]): DesktopInboxEntry[] {
  const entries: DesktopInboxEntry[] = []
  for (const row of rows) {
    const args = isPlainRecord(row.args) ? row.args : {}
    if (!isBackgroundDesktopToolCall(row.toolName, args)) continue
    if (row.claimed) {
      if (row.status !== ASYNC_TOOL_STATUS.running)
        entries.push({ kind: 'cancel', toolCallId: row.toolCallId })
      continue
    }
    if (isAwaitingToolPermission(row)) {
      if (row.permissionDecision === null)
        entries.push({
          kind: 'approval_needed',
          toolCallId: row.toolCallId,
          toolName: row.toolName,
          chatId: row.chatId,
          chatTitle: row.chatTitle,
          workspaceId: row.workspaceId,
          summary: summarize(args),
        })
      continue
    }
    entries.push({
      kind: 'call',
      toolCallId: row.toolCallId,
      toolName: row.toolName,
      chatId: row.chatId,
      workspaceId: row.workspaceId,
      createdAt: row.createdAt,
    })
  }
  return entries
}
