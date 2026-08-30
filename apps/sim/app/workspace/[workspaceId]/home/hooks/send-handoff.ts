/**
 * Queued-send handoff (revamp M6 extraction, behavior-preserving): the sessionStorage
 * claim machinery that carries a queued outgoing message across a chat-scope handoff —
 * pure module-scope helpers moved verbatim out of use-chat.ts. State and claim rows are
 * TTL-bounded; every reader tolerates malformed or missing storage.
 */
import { generateId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import { STREAM_STORAGE_KEY } from '@/lib/mothership/constants'
import type { ChatContext } from '@/stores/panel'
import type { FileAttachmentForApi } from '../types'

const QUEUED_SEND_HANDOFF_STORAGE_KEY = `${STREAM_STORAGE_KEY}:queued-send-handoff`
const QUEUED_SEND_HANDOFF_CLAIM_STORAGE_KEY = `${STREAM_STORAGE_KEY}:queued-send-handoff-claim`
const QUEUED_SEND_HANDOFF_TTL_MS = 5 * 60 * 1000
const QUEUED_SEND_HANDOFF_CLAIM_TTL_MS = 30_000
const QUEUED_SEND_HANDOFF_RETRY_BASE_MS = 1000
const QUEUED_SEND_HANDOFF_RETRY_MAX_MS = 30_000

export interface QueuedSendHandoffState {
  id: string
  chatId?: string
  workspaceId: string
  supersededStreamId: string | null
  userMessageId: string
  message: string
  fileAttachments?: FileAttachmentForApi[]
  contexts?: ChatContext[]
  requestedAt: number
  resolveAttempts?: number
}

interface QueuedSendHandoffClaim {
  id: string
  ownerId: string
  claimedAt: number
}

function isFileAttachmentForApi(value: unknown): value is FileAttachmentForApi {
  if (!isRecordLike(value)) return false
  return (
    typeof value.id === 'string' &&
    typeof value.key === 'string' &&
    typeof value.filename === 'string' &&
    typeof value.media_type === 'string' &&
    typeof value.size === 'number' &&
    Number.isFinite(value.size) &&
    (value.path === undefined || typeof value.path === 'string')
  )
}

function isChatContext(value: unknown): value is ChatContext {
  if (!isRecordLike(value) || typeof value.kind !== 'string' || typeof value.label !== 'string') {
    return false
  }

  switch (value.kind) {
    case 'past_chat':
      return typeof value.chatId === 'string'
    case 'workflow':
    case 'current_workflow':
      return typeof value.workflowId === 'string'
    case 'blocks':
      return Array.isArray(value.blockIds) && value.blockIds.every((id) => typeof id === 'string')
    case 'logs':
      return value.executionId === undefined || typeof value.executionId === 'string'
    case 'workflow_block':
      return typeof value.workflowId === 'string' && typeof value.blockId === 'string'
    case 'knowledge':
      return value.knowledgeId === undefined || typeof value.knowledgeId === 'string'
    case 'table':
      return typeof value.tableId === 'string'
    case 'table_selection':
      return (
        typeof value.tableId === 'string' &&
        typeof value.tableName === 'string' &&
        Array.isArray(value.rowIds) &&
        value.rowIds.every((id) => typeof id === 'string')
      )
    case 'file':
      return typeof value.fileId === 'string'
    case 'file_selection':
      return (
        typeof value.fileId === 'string' &&
        typeof value.fileName === 'string' &&
        typeof value.text === 'string'
      )
    case 'folder':
      return typeof value.folderId === 'string'
    case 'filefolder':
      return typeof value.fileFolderId === 'string'
    case 'docs':
      return true
    case 'slash_command':
      return typeof value.command === 'string'
    case 'integration':
      return typeof value.blockType === 'string'
    case 'skill':
      return typeof value.skillId === 'string'
    case 'mcp':
      return typeof value.serverId === 'string'
    case 'browser_tab':
      return (
        typeof value.tabId === 'string' &&
        (value.selection === undefined ||
          (isRecordLike(value.selection) &&
            typeof value.selection.text === 'string' &&
            (value.selection.url === undefined || typeof value.selection.url === 'string') &&
            (value.selection.title === undefined || typeof value.selection.title === 'string')))
      )
    case 'terminal_tab':
      return (
        typeof value.terminalId === 'string' &&
        (value.selection === undefined ||
          (isRecordLike(value.selection) &&
            typeof value.selection.text === 'string' &&
            typeof value.selection.startLine === 'number' &&
            typeof value.selection.endLine === 'number' &&
            Number.isInteger(value.selection.startLine) &&
            Number.isInteger(value.selection.endLine) &&
            value.selection.startLine > 0 &&
            value.selection.endLine >= value.selection.startLine))
      )
    default:
      return false
  }
}

export function readQueuedSendHandoffState(): QueuedSendHandoffState | null {
  if (typeof window === 'undefined') return null

  try {
    const raw = window.sessionStorage.getItem(QUEUED_SEND_HANDOFF_STORAGE_KEY)
    if (!raw) return null

    const parsed = JSON.parse(raw) as Partial<QueuedSendHandoffState>
    const chatId = typeof parsed.chatId === 'string' ? parsed.chatId : undefined
    const supersededStreamId =
      typeof parsed.supersededStreamId === 'string' ? parsed.supersededStreamId : null
    if (
      typeof parsed?.id !== 'string' ||
      typeof parsed.workspaceId !== 'string' ||
      typeof parsed.userMessageId !== 'string' ||
      typeof parsed.message !== 'string' ||
      typeof parsed.requestedAt !== 'number' ||
      (!chatId && !supersededStreamId)
    ) {
      return null
    }
    if (Date.now() - parsed.requestedAt > QUEUED_SEND_HANDOFF_TTL_MS) {
      window.sessionStorage.removeItem(QUEUED_SEND_HANDOFF_STORAGE_KEY)
      if (readQueuedSendHandoffClaim() === parsed.id) {
        window.sessionStorage.removeItem(QUEUED_SEND_HANDOFF_CLAIM_STORAGE_KEY)
      }
      return null
    }

    return {
      id: parsed.id,
      ...(chatId ? { chatId } : {}),
      workspaceId: parsed.workspaceId,
      supersededStreamId,
      userMessageId: parsed.userMessageId,
      message: parsed.message,
      ...(Array.isArray(parsed.fileAttachments)
        ? { fileAttachments: parsed.fileAttachments.filter(isFileAttachmentForApi) }
        : {}),
      ...(Array.isArray(parsed.contexts)
        ? { contexts: parsed.contexts.filter(isChatContext) }
        : {}),
      requestedAt: parsed.requestedAt,
      ...(typeof parsed.resolveAttempts === 'number' &&
      Number.isFinite(parsed.resolveAttempts) &&
      parsed.resolveAttempts > 0
        ? { resolveAttempts: parsed.resolveAttempts }
        : {}),
    }
  } catch {
    return null
  }
}

export function writeQueuedSendHandoffState(state: QueuedSendHandoffState) {
  if (typeof window === 'undefined') return
  window.sessionStorage.setItem(QUEUED_SEND_HANDOFF_STORAGE_KEY, JSON.stringify(state))
}

export function clearQueuedSendHandoffState(expectedId?: string) {
  if (typeof window === 'undefined') return
  if (expectedId) {
    const current = readQueuedSendHandoffState()
    if (current && current.id !== expectedId) {
      return
    }
  }
  window.sessionStorage.removeItem(QUEUED_SEND_HANDOFF_STORAGE_KEY)
}

function readQueuedSendHandoffClaimState(): QueuedSendHandoffClaim | null {
  if (typeof window === 'undefined') return null
  const raw = window.sessionStorage.getItem(QUEUED_SEND_HANDOFF_CLAIM_STORAGE_KEY)
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as Partial<QueuedSendHandoffClaim>
    if (
      typeof parsed?.id !== 'string' ||
      typeof parsed.ownerId !== 'string' ||
      typeof parsed.claimedAt !== 'number'
    ) {
      window.sessionStorage.removeItem(QUEUED_SEND_HANDOFF_CLAIM_STORAGE_KEY)
      return null
    }
    if (Date.now() - parsed.claimedAt > QUEUED_SEND_HANDOFF_CLAIM_TTL_MS) {
      window.sessionStorage.removeItem(QUEUED_SEND_HANDOFF_CLAIM_STORAGE_KEY)
      return null
    }
    return { id: parsed.id, ownerId: parsed.ownerId, claimedAt: parsed.claimedAt }
  } catch {
    window.sessionStorage.removeItem(QUEUED_SEND_HANDOFF_CLAIM_STORAGE_KEY)
    return null
  }
}

export function readQueuedSendHandoffClaim(): string | null {
  return readQueuedSendHandoffClaimState()?.id ?? null
}

export function hasQueuedSendHandoffClaimOwner(id: string, ownerId: string): boolean {
  const claim = readQueuedSendHandoffClaimState()
  return claim?.id === id && claim.ownerId === ownerId
}

export function queuedSendHandoffClaimRetryDelay(id: string): number | null {
  const claim = readQueuedSendHandoffClaimState()
  if (!claim || claim.id !== id) return null
  const elapsed = Date.now() - claim.claimedAt
  return Math.max(0, QUEUED_SEND_HANDOFF_CLAIM_TTL_MS - elapsed + 1)
}

export function queuedSendHandoffResolveRetryDelay(resolveAttempts: number): number {
  return Math.min(
    QUEUED_SEND_HANDOFF_RETRY_MAX_MS,
    QUEUED_SEND_HANDOFF_RETRY_BASE_MS * 2 ** Math.max(0, resolveAttempts - 1)
  )
}

export function writeQueuedSendHandoffClaim(id: string): string {
  const ownerId = generateId()
  if (typeof window === 'undefined') return ownerId
  window.sessionStorage.setItem(
    QUEUED_SEND_HANDOFF_CLAIM_STORAGE_KEY,
    JSON.stringify({ id, ownerId, claimedAt: Date.now() } satisfies QueuedSendHandoffClaim)
  )
  return ownerId
}

export function clearQueuedSendHandoffClaim(expectedId?: string, expectedOwnerId?: string) {
  if (typeof window === 'undefined') return
  if (expectedId) {
    const current = readQueuedSendHandoffClaimState()
    if (
      current &&
      (current.id !== expectedId || (expectedOwnerId && current.ownerId !== expectedOwnerId))
    ) {
      return
    }
  }
  window.sessionStorage.removeItem(QUEUED_SEND_HANDOFF_CLAIM_STORAGE_KEY)
}
