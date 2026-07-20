import { db } from '@sim/db'
import { webhook, webhookPathClaim, workflow } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'
import { normalizeWebhookRegistrationPath } from '@/lib/webhooks/registration-identity'

/**
 * Returns the id of a different workflow that already owns the given path, or
 * `null` when the path is free or owned by `workflowId`.
 *
 * Ownership has two sources, checked in order:
 *
 * 1. `webhook_path_claim` — sticky ownership acquired by the stable
 *    registration protocol. Claims must be honored even while the owner's
 *    rows are non-deliverable candidates (mid-prepare) or mid-rotation,
 *    otherwise another workflow could take over the path in that window.
 * 2. Live webhook rows — mirrors the runtime dispatcher
 *    (`findAllWebhooksForPath`): an active, non-archived webhook on a
 *    non-archived workflow. All matching rows are scanned so a same-workflow
 *    row can never mask a foreign collision.
 */
export async function findConflictingWebhookPathOwner(params: {
  path: string
  workflowId: string
  tx?: DbOrTx
}): Promise<string | null> {
  const { path, workflowId, tx } = params
  const dbCtx = tx ?? db

  const normalizedPath = normalizeWebhookRegistrationPath(path)
  if (normalizedPath) {
    const [claim] = await dbCtx
      .select({ workflowId: webhookPathClaim.workflowId })
      .from(webhookPathClaim)
      .where(eq(webhookPathClaim.path, normalizedPath))
      .limit(1)
    if (claim && claim.workflowId !== workflowId) {
      return claim.workflowId
    }
  }

  const existing = await dbCtx
    .select({ workflowId: webhook.workflowId })
    .from(webhook)
    .innerJoin(workflow, eq(webhook.workflowId, workflow.id))
    .where(
      and(
        eq(webhook.path, path),
        eq(webhook.isActive, true),
        isNull(webhook.archivedAt),
        isNull(workflow.archivedAt)
      )
    )

  const conflict = existing.find((row) => row.workflowId !== workflowId)
  return conflict ? conflict.workflowId : null
}
