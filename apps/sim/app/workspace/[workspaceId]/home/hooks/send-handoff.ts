import { isChatContext } from '@/lib/mothership/chat/context'
import { MAX_CHAT_CONTEXTS } from '@/lib/mothership/chat/context-limits'
/**
 * Queued-send handoff (revamp M6 extraction, behavior-preserving): the sessionStorage
 * claim machinery that carries a queued outgoing message across a chat-scope handoff —
 * pure module-scope helpers moved verbatim out of use-chat.ts. State and claim rows are
 * TTL-bounded; every reader tolerates malformed or missing storage.
 */

import { generateId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import {
  type WorkspaceSearchFilters,
  workspaceSearchFiltersSchema,
} from '@/lib/api/contracts/knowledge/search'
import { STREAM_STORAGE_KEY } from '@/lib/mothership/constants'
import { AssistantSearchLevel } from '@/lib/mothership/generated/assistant'
import type {
  ChatRequestMode,
  FileAttachmentForApi,
} from '@/app/workspace/[workspaceId]/home/types'
import type { QueuedSendHandoffSeed } from '@/stores/mothership-queue/types'
import type { ChatContext } from '@/stores/panel'

const QUEUED_SEND_HANDOFF_STORAGE_KEY = `${STREAM_STORAGE_KEY}:queued-send-handoff`
const QUEUED_SEND_HANDOFF_CLAIM_STORAGE_KEY = `${STREAM_STORAGE_KEY}:queued-send-handoff-claim`
const QUEUED_SEND_HANDOFF_TTL_MS = 5 * 60 * 1000
const QUEUED_SEND_HANDOFF_CLAIM_TTL_MS = 30_000
const QUEUED_SEND_HANDOFF_RETRY_BASE_MS = 1000
const QUEUED_SEND_HANDOFF_RETRY_MAX_MS = 30_000

export interface QueuedSendHandoffState extends QueuedSendHandoffSeed {
  workspaceId?: string
  organizationId?: string
  userMessageId: string
  message: string
  fileAttachments?: FileAttachmentForApi[]
  contexts?: ChatContext[]
  hasUnavailableContexts?: boolean
  requestMode?: ChatRequestMode
  assistantSearch?: WorkspaceSearchFilters
  assistantSearchLevel?: AssistantSearchLevel
  requestedAt: number
  resolveAttempts?: number
  /** Whether the server may already hold `userMessageId` (see `startSendMessage`). */
  admissionUnknown?: boolean
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
      (typeof parsed.workspaceId !== 'string' && typeof parsed.organizationId !== 'string') ||
      (typeof parsed.workspaceId === 'string' && typeof parsed.organizationId === 'string') ||
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

    const legacyFast = (parsed as { assistantFast?: unknown }).assistantFast
    if (
      parsed.assistantSearchLevel === undefined &&
      legacyFast !== undefined &&
      typeof legacyFast !== 'boolean'
    )
      return null
    const rawLevel =
      parsed.assistantSearchLevel ??
      (legacyFast === true ? 'fast' : legacyFast === false ? 'adaptive' : undefined)
    const searchLevel = AssistantSearchLevel.optional().safeParse(rawLevel)
    if (!searchLevel.success) return null
    const assistantSearch = workspaceSearchFiltersSchema.safeParse(parsed.assistantSearch ?? {})
    if (!assistantSearch.success) return null

    const contexts = Array.isArray(parsed.contexts)
      ? parsed.contexts.filter(isChatContext).slice(0, MAX_CHAT_CONTEXTS)
      : undefined
    const hasUnavailableContexts =
      parsed.hasUnavailableContexts === true ||
      (parsed.contexts !== undefined &&
        (!Array.isArray(parsed.contexts) || contexts?.length !== parsed.contexts.length))

    return {
      id: parsed.id,
      ...(chatId ? { chatId } : {}),
      workspaceId: parsed.workspaceId,
      organizationId: parsed.organizationId,
      supersededStreamId,
      ...(parsed.stopRequired === true ? { stopRequired: true } : {}),
      ...(typeof parsed.admissionUnknown === 'boolean'
        ? { admissionUnknown: parsed.admissionUnknown }
        : {}),
      userMessageId: parsed.userMessageId,
      message: parsed.message,
      ...(Array.isArray(parsed.fileAttachments)
        ? { fileAttachments: parsed.fileAttachments.filter(isFileAttachmentForApi) }
        : {}),
      ...(contexts ? { contexts } : {}),
      ...(hasUnavailableContexts ? { hasUnavailableContexts: true } : {}),
      ...(parsed.requestMode === 'assistant' ||
      parsed.requestMode === 'agent' ||
      parsed.requestMode === 'plan'
        ? { requestMode: parsed.requestMode }
        : {}),
      ...(parsed.assistantSearch ? { assistantSearch: assistantSearch.data } : {}),
      ...(searchLevel.data !== undefined ? { assistantSearchLevel: searchLevel.data } : {}),
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
