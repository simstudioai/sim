import { db } from '@sim/db'
import { webhook, workflow, workflowDeploymentVersion } from '@sim/db/schema'
import { and, eq, inArray, isNull, or } from 'drizzle-orm'
import { CREDENTIAL_GROUP_TRIGGER_PROVIDER } from '@/lib/credential-groups/trigger-constants'
import { deliverableWebhookPredicate } from '@/lib/webhooks/delivery-predicate'
import type { WebhookRecord, WorkflowRecord } from '@/lib/webhooks/polling/types'

export interface CredentialGroupTriggerSubscription {
  webhook: WebhookRecord
  workflow: WorkflowRecord
}

/** Loads only deployed subscriptions in the source workspace that may read this group. */
export async function fetchCredentialGroupTriggerSubscriptions(
  workspaceId: string,
  allowedWorkflowIds: string[]
): Promise<CredentialGroupTriggerSubscription[]> {
  if (allowedWorkflowIds.length === 0) return []
  return db
    .select({ webhook, workflow })
    .from(webhook)
    .innerJoin(workflow, eq(webhook.workflowId, workflow.id))
    .leftJoin(
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
        eq(workflow.workspaceId, workspaceId),
        inArray(workflow.id, allowedWorkflowIds),
        eq(workflow.isDeployed, true),
        isNull(workflow.archivedAt),
        or(
          eq(webhook.deploymentVersionId, workflowDeploymentVersion.id),
          and(isNull(workflowDeploymentVersion.id), isNull(webhook.deploymentVersionId))
        )
      )
    )
}
