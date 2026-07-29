import type { CopilotToolPermissionDecision } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { getAsyncToolCall } from '@/lib/copilot/async-runs/repository'
import { createPubSubChannel, type PubSubChannel } from '@/lib/events/pubsub'

const logger = createLogger('CopilotToolPermission')

export const TOOL_PERMISSION_DECISION = {
  allow: 'allow',
  /** Allowed for the rest of this chat only. */
  allow_chat: 'allow_chat',
  /** Allowed in every chat, from now on. */
  always_allow: 'always_allow',
  skip: 'skip',
} as const satisfies Record<CopilotToolPermissionDecision, CopilotToolPermissionDecision>

export type ToolPermissionDecision = CopilotToolPermissionDecision

export interface ToolPermissionEnvelope {
  toolCallId: string
  decision: ToolPermissionDecision
  toolName?: string
  decidedAt?: string
}

/** Every allow variant runs the tool; they differ only in what gets remembered. */
export function decisionAllowsExecution(decision: ToolPermissionDecision): boolean {
  return decision !== TOOL_PERMISSION_DECISION.skip
}

/** True for the decisions that suppress future prompts for the same tool. */
export function decisionSuppressesFuturePrompts(decision: ToolPermissionDecision): boolean {
  return (
    decision === TOOL_PERMISSION_DECISION.allow_chat ||
    decision === TOOL_PERMISSION_DECISION.always_allow
  )
}

export function isToolPermissionDecision(value: unknown): value is ToolPermissionDecision {
  return (
    value === TOOL_PERMISSION_DECISION.allow ||
    value === TOOL_PERMISSION_DECISION.allow_chat ||
    value === TOOL_PERMISSION_DECISION.always_allow ||
    value === TOOL_PERMISSION_DECISION.skip
  )
}

type ToolPermissionGlobal = typeof globalThis & {
  _toolPermissionChannel?: PubSubChannel<ToolPermissionEnvelope>
}

const _g = globalThis as ToolPermissionGlobal
if (!_g._toolPermissionChannel) {
  _g._toolPermissionChannel = createPubSubChannel<ToolPermissionEnvelope>({
    channel: 'copilot:tool-permission',
    label: 'CopilotToolPermission',
  })
}
const toolPermissionChannel = _g._toolPermissionChannel

export function publishToolPermissionDecision(event: ToolPermissionEnvelope): void {
  logger.info('Publishing tool permission decision', {
    toolCallId: event.toolCallId,
    decision: event.decision,
  })
  toolPermissionChannel.publish(event)
}

/**
 * Read a decision straight from the durable async tool row.
 *
 * This is the reload path: the prompt outlives the browser tab, so the answer
 * has to be recoverable from Postgres rather than only from a live pubsub
 * message.
 */
export async function getToolPermissionDecision(
  toolCallId: string
): Promise<ToolPermissionEnvelope | null> {
  const row = await getAsyncToolCall(toolCallId).catch((err) => {
    logger.warn('Failed to read tool permission decision', {
      toolCallId,
      error: toError(err).message,
    })
    return null
  })
  if (!row?.permissionDecision) return null
  return {
    toolCallId,
    decision: row.permissionDecision,
    toolName: row.toolName,
    decidedAt: row.permissionDecidedAt?.toISOString(),
  }
}

/**
 * Block until the user answers a permission prompt.
 *
 * Mirrors `waitForToolConfirmation`: subscribe first, then read the durable
 * row, so a decision that lands between those two steps — or that was made
 * against a different server instance, or before this waiter existed at all —
 * is still picked up. Resolves `null` on timeout or abort; callers treat that
 * as "no decision" and fail the tool rather than running it.
 */
export async function waitForToolPermissionDecision(
  toolCallId: string,
  timeoutMs: number,
  abortSignal?: AbortSignal
): Promise<ToolPermissionEnvelope | null> {
  return new Promise((resolve) => {
    let settled = false
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    let unsubscribe: (() => void) | null = null

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId)
      if (unsubscribe) unsubscribe()
      abortSignal?.removeEventListener('abort', onAbort)
    }

    const settle = (value: ToolPermissionEnvelope | null) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(value)
    }

    const onAbort = () => settle(null)

    unsubscribe = toolPermissionChannel.subscribe((event) => {
      if (event.toolCallId !== toolCallId) return
      if (!isToolPermissionDecision(event.decision)) return
      logger.info('Resolved tool permission from pubsub', {
        toolCallId,
        decision: event.decision,
      })
      settle(event)
    })

    timeoutId = setTimeout(() => settle(null), timeoutMs)
    if (abortSignal?.aborted) {
      settle(null)
      return
    }
    abortSignal?.addEventListener('abort', onAbort, { once: true })

    void getToolPermissionDecision(toolCallId).then((existing) => {
      if (!existing) return
      logger.info('Resolved tool permission from durable row', {
        toolCallId,
        decision: existing.decision,
      })
      settle(existing)
    })
  })
}
