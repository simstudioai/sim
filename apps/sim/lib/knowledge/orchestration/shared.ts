import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import {
  asOrchestrationError,
  type OrchestrationErrorCode,
  type OrchestrationRequestContext,
} from '@/lib/core/orchestration/types'

const logger = createLogger('KnowledgeOrchestration')

/**
 * Which surface an operation came in through. Recorded in the audit metadata so
 * the audit list still distinguishes a knowledge base the UI created from one an
 * API key or the agent created, now that all three share one description.
 */
export type KnowledgeOperationSource = 'ui' | 'api' | 'agent'

/** The acting user, plus the labels the audit row displays when it has them. */
export interface KnowledgeActor {
  userId: string
  actorName?: string | null
  actorEmail?: string | null
  source: KnowledgeOperationSource
}

/** Fields every knowledge orchestration function accepts. */
export interface KnowledgeOperationContext extends KnowledgeActor {
  requestId?: string
  /** Forwarded to the audit record for IP / user-agent capture. */
  request?: OrchestrationRequestContext
}

export interface KnowledgeOrchestrationFailure {
  success: false
  error: string
  errorCode: OrchestrationErrorCode
}

/**
 * Every knowledge orchestration function returns this shape. A discriminated
 * union rather than an all-optional record, so `if (!outcome.success) return …`
 * narrows the success branch and callers reach the payload without asserting it
 * is there.
 */
export type KnowledgeOrchestrationResult<TData extends object = object> =
  | ({ success: true } & TData)
  | KnowledgeOrchestrationFailure

export function fail(
  error: string,
  errorCode: OrchestrationErrorCode
): KnowledgeOrchestrationFailure {
  return { success: false, error, errorCode }
}

/**
 * Maps a thrown failure to its transport-neutral class.
 *
 * Every caller-fixable knowledge failure is an {@link OrchestrationError}
 * subclass, so the class decides the status rather than the message wording.
 * Anything unclassified stays a generic 500, which is what an unexpected fault
 * should be, and is logged here because no layer above will see the cause.
 */
export function classifyKnowledgeFailure(
  error: unknown,
  requestId: string,
  operation: string
): KnowledgeOrchestrationFailure {
  const classified = asOrchestrationError(error)
  if (classified) {
    return fail(classified.message, classified.code)
  }
  logger.error(`[${requestId}] ${operation} failed`, { error })
  return fail(toError(error).message, 'internal')
}

/** The audit fields carried from the actor, omitting labels the caller lacks. */
export function auditActorFields(actor: KnowledgeActor) {
  return {
    actorId: actor.userId,
    ...(actor.actorName !== undefined ? { actorName: actor.actorName } : {}),
    ...(actor.actorEmail !== undefined ? { actorEmail: actor.actorEmail } : {}),
  }
}
