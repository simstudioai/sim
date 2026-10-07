/**
 * The device side of Sim's background executor protocol (`/api/desktop/devices`, `/inbox`,
 * `/inbox/stream`, `/tool/claim`, `/tool/lease`, `/tool/complete`). Sim's contracts are the
 * source of truth; responses are parsed defensively here because a malformed one must never
 * reach a tool.
 */
import { isDesktopScopeId } from '@sim/desktop-bridge'
import type { DesktopToolCompletion } from '@sim/desktop-bridge/tool-results'
import { isRecordLike } from '@sim/utils/object'

/** The executor protocol version this build speaks. */
export const DESKTOP_EXECUTOR_PROTOCOL_VERSION = 1

/** Sim refuses a longer completion message, so longer ones are cut before they are sent. */
export const COMPLETION_MESSAGE_MAX_CHARS = 10_000

export interface DesktopDeviceRegistration {
  deviceId: string
  name: string
  appVersion: string
  platform: string
  capabilities: { executor: number; browser: boolean; terminal: boolean; localFiles: boolean }
}

/** Sim's answer to a registration. `enabled: false` means no new turn will bind to this device. */
export interface DesktopExecutorTiming {
  enabled: boolean
  protocolVersion: number
  leaseMs: number
  leaseRenewMs: number
  reconcileMs: number
}

export type DesktopInboxItem =
  | {
      kind: 'call'
      toolCallId: string
      toolName: string
      chatId: string
      workspaceId: string | null
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

/** A call this device now owns: the server's canonical arguments and the token that fences it. */
export interface ClaimedDesktopCall {
  toolCallId: string
  toolName: string
  args: Record<string, unknown>
  chatId: string
  workspaceId: string | null
  executionToken: string
}

export type DesktopCompletionOutcome = 'recorded' | 'duplicate' | 'superseded'

export interface DesktopCompletionRequest {
  toolCallId: string
  executionToken: string
  completion: DesktopToolCompletion
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

export function parseRegistration(body: unknown): DesktopExecutorTiming | null {
  if (
    !isRecordLike(body) ||
    typeof body.enabled !== 'boolean' ||
    !positiveInteger(body.protocolVersion) ||
    !positiveInteger(body.leaseMs) ||
    !positiveInteger(body.leaseRenewMs) ||
    !positiveInteger(body.reconcileMs)
  ) {
    return null
  }
  return {
    enabled: body.enabled,
    protocolVersion: body.protocolVersion,
    leaseMs: body.leaseMs,
    leaseRenewMs: body.leaseRenewMs,
    reconcileMs: body.reconcileMs,
  }
}

function parseInboxItem(value: unknown): DesktopInboxItem | null {
  if (!isRecordLike(value) || typeof value.toolCallId !== 'string' || !value.toolCallId) return null
  const { toolCallId } = value
  if (value.kind === 'cancel') return { kind: 'cancel', toolCallId }
  if (
    typeof value.toolName !== 'string' ||
    typeof value.chatId !== 'string' ||
    !isDesktopScopeId(value.chatId) ||
    !nullableString(value.workspaceId)
  ) {
    return null
  }
  if (value.kind === 'call') {
    return {
      kind: 'call',
      toolCallId,
      toolName: value.toolName,
      chatId: value.chatId,
      workspaceId: value.workspaceId,
    }
  }
  if (
    value.kind === 'approval_needed' &&
    nullableString(value.chatTitle) &&
    nullableString(value.summary)
  ) {
    return {
      kind: 'approval_needed',
      toolCallId,
      toolName: value.toolName,
      chatId: value.chatId,
      chatTitle: value.chatTitle,
      workspaceId: value.workspaceId,
      summary: value.summary,
    }
  }
  return null
}

/** Unknown item kinds are skipped, so a newer Sim can add one without breaking this build. */
export function parseInbox(body: unknown): DesktopInboxItem[] | null {
  if (!isRecordLike(body) || !Array.isArray(body.items)) return null
  return body.items.flatMap((item) => {
    const parsed = parseInboxItem(item)
    return parsed ? [parsed] : []
  })
}

export function parseClaim(toolCallId: string, body: unknown): ClaimedDesktopCall | null {
  if (
    !isRecordLike(body) ||
    typeof body.toolName !== 'string' ||
    !isRecordLike(body.args) ||
    typeof body.chatId !== 'string' ||
    !isDesktopScopeId(body.chatId) ||
    !nullableString(body.workspaceId) ||
    typeof body.executionToken !== 'string' ||
    !body.executionToken
  ) {
    return null
  }
  return {
    toolCallId,
    toolName: body.toolName,
    args: body.args,
    chatId: body.chatId,
    workspaceId: body.workspaceId,
    executionToken: body.executionToken,
  }
}

export function parseCompletionOutcome(body: unknown): DesktopCompletionOutcome | null {
  if (!isRecordLike(body)) return null
  return body.outcome === 'recorded' ||
    body.outcome === 'duplicate' ||
    body.outcome === 'superseded'
    ? body.outcome
    : null
}
