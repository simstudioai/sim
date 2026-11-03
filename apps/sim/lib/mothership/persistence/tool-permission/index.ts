import type { CopilotToolPermissionDecision } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { backoffWithJitter } from '@sim/utils/retry'
import { createPubSubChannel, type PubSubChannel } from '@/lib/events/pubsub'
import { isExecutableToolPermissionDecision } from '@/lib/mothership/async-runs/lifecycle'
import { getAsyncToolCall } from '@/lib/mothership/async-runs/repository'

const logger = createLogger('CopilotToolPermission')
const DECISION_RECHECK_BACKOFF = { baseMs: 1_000, maxMs: 10_000 } as const

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
  return isExecutableToolPermissionDecision(decision)
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
 * is still picked up. Bounded durable rechecks also recover a missed notification.
 * Resolves `null` on timeout or abort; callers treat that as "no decision".
 */
export async function waitForToolPermissionDecision(
  toolCallId: string,
  timeoutMs: number,
  abortSignal?: AbortSignal
): Promise<ToolPermissionEnvelope | null> {
  return new Promise((resolve) => {
    let settled = false
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    let recheckId: ReturnType<typeof setTimeout> | null = null
    let recheckAttempt = 0
    let unsubscribe: (() => void) | null = null

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId)
      if (recheckId) clearTimeout(recheckId)
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

    const readDecision = async () => {
      if (settled) return
      const existing = await getToolPermissionDecision(toolCallId)
      if (settled) return
      if (existing) {
        logger.info('Resolved tool permission from durable row', {
          toolCallId,
          decision: existing.decision,
        })
        settle(existing)
        return
      }
      recheckAttempt += 1
      recheckId = setTimeout(
        () => void readDecision(),
        backoffWithJitter(recheckAttempt, null, DECISION_RECHECK_BACKOFF)
      )
    }
    void readDecision()
  })
}
