import { AuditAction, AuditResourceType } from '@sim/audit'
import { type Principal, resolvePrincipalAttribution } from '@sim/auth/principal'
import { db } from '@sim/db'
import { generateRequestId } from '@/lib/core/utils/request'
import { notifyWorkflowUpdated } from '@/lib/realtime/notify'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import { resolveActiveWorkflowApplicationContext } from '@/lib/workflows/application/context'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { assertedWorkflowWorkspaceId } from '@/lib/workflows/application/principal-scope'
import { duplicateWorkflow as duplicateWorkflowRecord } from '@/lib/workflows/persistence/duplicate'

export interface DuplicateWorkflowInput {
  sourceWorkflowId: string
  assertedWorkspaceId?: string
  folderId: string | null
  name: string
}

export const duplicateWorkflow = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.duplicate,
  resolveContext: ({ principal, input }: { principal: Principal; input: DuplicateWorkflowInput }) =>
    resolveActiveWorkflowApplicationContext({
      workflowId: input.sourceWorkflowId,
      assertedWorkspaceId: assertedWorkflowWorkspaceId(principal, input.assertedWorkspaceId),
    }),
  async execute({ principal, input, context }) {
    const attribution = resolvePrincipalAttribution(principal, {
      workspaceBillingOwnerUserId: context.billedAccountUserId,
    })
    return db.transaction((tx) =>
      duplicateWorkflowRecord({
        sourceWorkflowId: context.workflowId,
        userId: attribution.attributedUserId,
        workspaceId: context.workspaceId,
        folderId: input.folderId,
        name: input.name,
        requestId: generateRequestId(),
        tx,
      })
    )
  },
  projectAudit: ({ context, result }) => ({
    action: AuditAction.WORKFLOW_DUPLICATED,
    resourceType: AuditResourceType.WORKFLOW,
    resourceId: result.id,
    resourceName: result.name,
    description: `Duplicated workflow "${context.workflow.name}" as "${result.name}"`,
    metadata: { sourceWorkflowId: context.workflowId, workspaceId: context.workspaceId },
  }),
  afterSuccess: ({ result }) => notifyWorkflowUpdated(result.id),
})
