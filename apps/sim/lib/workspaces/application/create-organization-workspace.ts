import { AuditAction, AuditResourceType } from '@sim/audit'
import { recordProjectedUseCaseAuditEntries } from '@/lib/core/application/authorized-workspace-use-case'
import type { OperationUseCase } from '@/lib/core/application/operation'
import { authorizeOrganizationOperation } from '@/lib/core/application/organization-authorization'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { refuseCapability } from '@/lib/permission-groups/capabilities'
import { organizationWorkspaceOperations } from '@/lib/workspaces/application/organization-operations'
import { createWorkspace } from '@/lib/workspaces/create'
import {
  type CreateWorkspaceInput,
  createWorkspaceInputSchema,
} from '@/lib/workspaces/create-input'
import {
  getWorkspaceCreationPolicy,
  WorkspaceCreationCapabilityWithheldError,
  WorkspaceCreationContextChangedError,
} from '@/lib/workspaces/policy'

export const createOrganizationWorkspace: OperationUseCase<
  typeof organizationWorkspaceOperations.create,
  CreateWorkspaceInput & { organizationId: string },
  Awaited<ReturnType<typeof createWorkspace>> & { organizationId: string }
> = {
  operation: organizationWorkspaceOperations.create,
  async execute({ principal, input, request }) {
    const context = await authorizeOrganizationOperation(
      principal,
      organizationWorkspaceOperations.create,
      input
    )
    const parsed = createWorkspaceInputSchema.safeParse(input)
    if (!parsed.success) throw new OrchestrationError('validation', 'A workspace name is required')
    const policy = await getWorkspaceCreationPolicy({
      userId: context.userId,
      activeOrganizationId: context.organizationId,
      pinOrganization: true,
    })
    if (!policy.canCreate) {
      if (policy.blockedReasonCode === 'permission-group-denied')
        refuseCapability('workspace.create')
      throw new OrchestrationError(
        'forbidden',
        policy.reason ?? 'Workspace creation is not allowed'
      )
    }
    if (policy.organizationId !== context.organizationId || policy.workspaceMode !== 'organization')
      throw new OrchestrationError(
        'forbidden',
        'This organization cannot create workspaces under its current subscription'
      )
    let workspace: Awaited<ReturnType<typeof createWorkspace>>
    try {
      workspace = await createWorkspace({
        ...parsed.data,
        userId: context.userId,
        organizationId: policy.organizationId,
        workspaceMode: policy.workspaceMode,
        billedAccountUserId: policy.billedAccountUserId,
        observedOrganizationId: policy.observedOrganizationId,
        governingPermissionGroupOrganizationId: policy.governingPermissionGroupOrganizationId,
      })
    } catch (error) {
      if (error instanceof WorkspaceCreationCapabilityWithheldError)
        refuseCapability('workspace.create')
      if (error instanceof WorkspaceCreationContextChangedError)
        throw new OrchestrationError(
          'conflict',
          'Organization membership changed; retry workspace creation'
        )
      throw error
    }
    recordProjectedUseCaseAuditEntries(
      organizationWorkspaceOperations.create,
      workspace.id,
      principal,
      request,
      [
        {
          action: AuditAction.WORKSPACE_CREATED,
          resourceType: AuditResourceType.WORKSPACE,
          resourceId: workspace.id,
          resourceName: workspace.name,
          description: `Created workspace "${workspace.name}"`,
          metadata: { name: workspace.name, workspaceMode: workspace.workspaceMode },
        },
      ],
      context.organizationId
    )
    return { ...workspace, organizationId: context.organizationId }
  },
}
