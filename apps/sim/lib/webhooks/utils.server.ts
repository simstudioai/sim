import { db } from '@sim/db'
import { webhook, workflow } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'

/**
 * Returns the id of a different workflow that already owns an active webhook on
 * the given path, or `null` if the path is free or owned by `workflowId`.
 *
 * Webhook paths are user-controlled and the database only enforces uniqueness
 * per deployment version, so this is the single guard against cross-tenant path
 * collisions for every webhook creation path. The filter mirrors the runtime
 * dispatcher (`findAllWebhooksForPath`): an active, non-archived webhook on a
 * non-archived workflow — inactive or archived webhooks never receive
 * deliveries, so they must not reserve a path. All matching rows are scanned so
 * a same-workflow row can never mask a foreign collision.
 */
export async function findConflictingWebhookPathOwner(params: {
  path: string
  workflowId: string
  tx?: DbOrTx
}): Promise<string | null> {
  const { path, workflowId, tx } = params
  const dbCtx = tx ?? db

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
