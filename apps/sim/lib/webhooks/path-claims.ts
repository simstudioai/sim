import { webhookPathClaim } from '@sim/db/schema'
import type { DbOrTx } from '@sim/workflow-persistence/types'
import { and, eq, lte } from 'drizzle-orm'
import { normalizeWebhookRegistrationPath } from '@/lib/webhooks/registration-identity'

export class WebhookPathClaimConflictError extends Error {
  readonly code = 'webhook_path_conflict'

  constructor(
    readonly path: string,
    readonly ownerWorkflowId: string
  ) {
    super(`Webhook path "${path}" is already owned by workflow ${ownerWorkflowId}`)
    this.name = 'WebhookPathClaimConflictError'
  }
}

export class StaleWebhookPathClaimGenerationError extends Error {
  readonly code = 'stale_webhook_path_claim_generation'

  constructor(
    readonly path: string,
    readonly attemptedGeneration: number,
    readonly currentGeneration: number
  ) {
    super(
      `Webhook path "${path}" is already fenced at generation ${currentGeneration}; generation ${attemptedGeneration} is stale`
    )
    this.name = 'StaleWebhookPathClaimGenerationError'
  }
}

function normalizeClaimPath(path: string): string {
  const normalizedPath = normalizeWebhookRegistrationPath(path)
  if (!normalizedPath) {
    throw new TypeError('Webhook path claim cannot be empty')
  }
  return normalizedPath
}

function assertClaimGeneration(generation: number): void {
  if (!Number.isSafeInteger(generation) || generation < 0) {
    throw new TypeError('Webhook path claim generation must be a non-negative safe integer')
  }
}

/**
 * Releases every path claim held by a workflow.
 *
 * Claims stay sticky through generation rotations, but once a workflow is
 * explicitly undeployed or archived it no longer serves traffic, so other
 * workflows must be able to adopt its paths. Runs inside the caller's
 * undeploy/archive transaction.
 */
export async function releaseWebhookPathClaims(tx: DbOrTx, workflowId: string): Promise<void> {
  await tx.delete(webhookPathClaim).where(eq(webhookPathClaim.workflowId, workflowId))
}

/**
 * Atomically acquires or advances ownership of a normalized webhook path.
 *
 * Ownership never transfers between workflows. The conflict update is generation-CAS guarded,
 * so the primary-key write is the ownership decision rather than a preceding availability check.
 */
export async function claimWebhookPath(
  tx: DbOrTx,
  input: { path: string; workflowId: string; generation: number }
): Promise<string> {
  const path = normalizeClaimPath(input.path)
  assertClaimGeneration(input.generation)
  const now = new Date()

  const [claimed] = await tx
    .insert(webhookPathClaim)
    .values({
      path,
      workflowId: input.workflowId,
      generation: input.generation,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: webhookPathClaim.path,
      set: {
        generation: input.generation,
        updatedAt: now,
      },
      setWhere: and(
        eq(webhookPathClaim.workflowId, input.workflowId),
        lte(webhookPathClaim.generation, input.generation)
      ),
    })
    .returning({
      path: webhookPathClaim.path,
      workflowId: webhookPathClaim.workflowId,
      generation: webhookPathClaim.generation,
    })

  if (claimed) return claimed.path

  const [current] = await tx
    .select({
      workflowId: webhookPathClaim.workflowId,
      generation: webhookPathClaim.generation,
    })
    .from(webhookPathClaim)
    .where(eq(webhookPathClaim.path, path))
    .limit(1)

  if (!current) {
    throw new Error(`Webhook path "${path}" could not be claimed`)
  }
  if (current.workflowId !== input.workflowId) {
    throw new WebhookPathClaimConflictError(path, current.workflowId)
  }
  throw new StaleWebhookPathClaimGenerationError(path, input.generation, current.generation)
}
