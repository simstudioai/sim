import { db } from '@sim/db'
import { webhook, workflow, workflowDeploymentVersion, workspace } from '@sim/db/schema'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { CREDENTIAL_GROUP_TRIGGER_PROVIDER } from '@/lib/credential-groups/trigger-constants'
import { deliverableWebhookPredicate } from '@/lib/webhooks/delivery-predicate'
import type { WebhookRecord, WorkflowRecord } from '@/lib/webhooks/polling/types'

export interface CredentialGroupTriggerSubscription {
  webhook: WebhookRecord
  workflow: WorkflowRecord
}

/** Loads opted-in Credential triggers deployed in currently allowed organization workspaces. */
export async function fetchCredentialGroupTriggerSubscriptions(
  organizationId: string,
  allowedWorkspaceIds: string[]
): Promise<CredentialGroupTriggerSubscription[]> {
  if (allowedWorkspaceIds.length === 0) return []
  const subscriptions = await db
    .select({ webhook, workflow })
    .from(webhook)
    .innerJoin(workflow, eq(webhook.workflowId, workflow.id))
    .innerJoin(workspace, eq(workspace.id, workflow.workspaceId))
    .innerJoin(
      workflowDeploymentVersion,
      and(
        eq(workflowDeploymentVersion.workflowId, workflow.id),
        eq(workflowDeploymentVersion.isActive, true)
      )
    )
    .where(
      and(
        eq(webhook.provider, CREDENTIAL_GROUP_TRIGGER_PROVIDER),
        deliverableWebhookPredicate(webhook),
        eq(workspace.organizationId, organizationId),
        isNull(workspace.archivedAt),
        inArray(workflow.workspaceId, allowedWorkspaceIds),
        eq(workflow.isDeployed, true),
        isNull(workflow.archivedAt),
        eq(webhook.deploymentVersionId, workflowDeploymentVersion.id),
        sql`${workflowDeploymentVersion.state}::jsonb -> 'blocks' -> ${webhook.blockId} ->> 'type' = 'credential'`
      )
    )
    .limit(1001)
  if (subscriptions.length > 1000)
    throw new Error('Organization connected account events exceed the 1000 subscriber limit')
  return subscriptions
}
