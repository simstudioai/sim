import { resourceScopeFromOwner, resourceScopeKey } from '@/lib/core/resource-scope'
import type {
  DocumentProcessingBillingContext,
  DocumentProcessingPayload,
} from '@/lib/knowledge/documents/processing-payload'
import { QUEUED_DISPATCH_START_DEADLINE_MS } from '@/lib/knowledge/documents/types'

/**
 * Queue backing the interactive lane.
 *
 * Deliberately the name the single shared queue already used in every deployed
 * environment. A queue named at trigger time that the running Trigger.dev
 * version has not registered leaves its run in `PENDING_VERSION` until the
 * worker deploy catches up, and the app and worker deploy separately. Keeping
 * person-facing work on the pre-existing name means only the backfill lane can
 * be caught by that window, and stranded backfill work is exactly what the
 * stuck-document sweep already recovers.
 */
export const INTERACTIVE_PROCESSING_QUEUE_NAME = 'document-processing-queue'

export const BACKFILL_PROCESSING_QUEUE_NAME = 'document-processing-backfill-queue'

/**
 * The fairness key a lane's concurrency limit is applied per copy of.
 *
 * Keyed on the entity that owns the knowledge base, which is the entity whose
 * sync can produce unbounded work — not on the workspace alone. An
 * organization-scoped knowledge base carries `workspaceId: null`, so keying on
 * the workspace would collapse every such tenant onto one shared bucket and
 * reproduce the starvation the lanes exist to prevent.
 *
 * Owned scopes defer to {@link resourceScopeKey} so tenant identity has one
 * spelling across the codebase. A knowledge base with neither owner has no
 * `ResourceScope`, and falls back to the actor that created it.
 */
function documentProcessingTenantKey(context: DocumentProcessingBillingContext): string {
  return context.billingScope === 'non-workspace'
    ? `user:${context.actorUserId}`
    : resourceScopeKey(resourceScopeFromOwner(context))
}

/**
 * Trigger.dev options placing one payload in its lane's per-tenant queue copy.
 * Both must be set together: the queue name alone is shared by every tenant,
 * and the key alone would split whichever queue the payload happened to land in.
 */
export function documentProcessingQueueOptions(payload: DocumentProcessingPayload): {
  queue: string
  concurrencyKey: string
} {
  return {
    queue:
      payload.processingLane === 'interactive'
        ? INTERACTIVE_PROCESSING_QUEUE_NAME
        : BACKFILL_PROCESSING_QUEUE_NAME,
    concurrencyKey: documentProcessingTenantKey(payload),
  }
}

/**
 * Trigger.dev `ttl` expiring a run unstarted at its generation's start deadline
 * (queue stamp + {@link QUEUED_DISPATCH_START_DEADLINE_MS}). Trigger.dev counts `ttl`
 * from enqueue, which for a delayed run is `notBefore`. A generation already past its
 * deadline gets the one-second minimum; one without a stamp keeps the queue default.
 */
export function documentProcessingRunExpiry(
  payload: Pick<DocumentProcessingPayload, 'processingQueuedAt'>,
  notBefore?: Date
): { ttl?: number } {
  if (!payload.processingQueuedAt) return {}
  const deadline =
    new Date(payload.processingQueuedAt).getTime() + QUEUED_DISPATCH_START_DEADLINE_MS
  const enqueuedAt = Math.max(Date.now(), notBefore?.getTime() ?? 0)
  return { ttl: Math.max(1, Math.floor((deadline - enqueuedAt) / 1000)) }
}

/**
 * Every Trigger.dev option a `knowledge-process-document` dispatch needs: its lane's
 * per-tenant queue and its start deadline. Dispatch sites use this rather than the
 * parts so none can enqueue a run that outlives recovery's grace.
 */
export function documentProcessingRunOptions(
  payload: DocumentProcessingPayload,
  notBefore?: Date
): { queue: string; concurrencyKey: string; ttl?: number } {
  return {
    ...documentProcessingQueueOptions(payload),
    ...documentProcessingRunExpiry(payload, notBefore),
  }
}
