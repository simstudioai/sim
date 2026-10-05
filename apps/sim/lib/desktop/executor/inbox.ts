import { isPlainRecord } from '@sim/utils/object'
import { truncate } from '@sim/utils/string'
import type { DesktopInboxRow } from '@/lib/desktop/executor/repository'
import { desktopCallAwaitsApproval, isDesktopExecutorTool } from '@/lib/desktop/executor/tools'
import { ASYNC_TOOL_STATUS } from '@/lib/mothership/async-runs/lifecycle'

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

function isRunOpen(row: DesktopInboxRow): boolean {
  return (
    !row.admissionClosed &&
    row.runStatus !== 'complete' &&
    row.runStatus !== 'error' &&
    row.runStatus !== 'cancelled'
  )
}

function summarize(args: Record<string, unknown>): string | null {
  return typeof args.command === 'string' && args.command.trim()
    ? truncate(args.command.trim(), SUMMARY_MAX_LENGTH)
    : null
}

/**
 * Classifies inbox rows:
 * - `call`: offered to the device and inside its pickup deadline.
 * - `approval_needed`: held for the user's decision, so the device can notify.
 * - `cancel`: a call the device claimed that it must stop, because the run was stopped, the call
 *   was settled without the device's result, or its lease lapsed. It stays listed until the
 *   device posts a result for it, which acknowledges the cancellation.
 * A call the device is running normally is not listed: the device already holds it.
 */
export function classifyDesktopInbox(rows: DesktopInboxRow[]): DesktopInboxEntry[] {
  const entries: DesktopInboxEntry[] = []
  for (const row of rows) {
    const args = isPlainRecord(row.args) ? row.args : {}
    if (!isDesktopExecutorTool(row.toolName, args)) continue
    const open = isRunOpen(row)
    if (row.claimed) {
      if (row.settled) continue
      const running =
        row.status === ASYNC_TOOL_STATUS.running && open && !row.revoked && row.leaseLive
      if (!running) entries.push({ kind: 'cancel', toolCallId: row.toolCallId })
      continue
    }
    if (row.status !== ASYNC_TOOL_STATUS.pending || !open) continue
    if (row.leaseLive) {
      if (row.permissionDecision === 'skip') continue
      entries.push({
        kind: 'call',
        toolCallId: row.toolCallId,
        toolName: row.toolName,
        chatId: row.chatId,
        workspaceId: row.workspaceId,
        createdAt: row.createdAt,
      })
      continue
    }
    if (row.permissionDecision === null && desktopCallAwaitsApproval(row.toolName, args)) {
      entries.push({
        kind: 'approval_needed',
        toolCallId: row.toolCallId,
        toolName: row.toolName,
        chatId: row.chatId,
        chatTitle: row.chatTitle,
        workspaceId: row.workspaceId,
        summary: summarize(args),
      })
    }
  }
  return entries
}
