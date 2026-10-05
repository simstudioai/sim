import { AuditAction, AuditResourceType } from '@sim/audit'
import { db } from '@sim/db'
import { getPostgresConstraintName, getPostgresErrorCode } from '@sim/utils/errors'
import { recordProjectedUseCaseAuditEntries } from '@/lib/core/application/authorized-workspace-use-case'
import type { OperationUseCase } from '@/lib/core/application/operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { refuseCapability } from '@/lib/permission-groups/capabilities'
import { requireProjectPrincipal } from '@/lib/projects/application/authorization'
import { projectOperations } from '@/lib/projects/application/operations'
import type { CreateProjectInput } from '@/lib/projects/create-input'
import { requireProjectApiEnabled } from '@/lib/projects/rollout.server'
import {
  createWorkspaceWithProjectInTransaction,
  emitWorkspaceCreatedPlatformEvent,
} from '@/lib/workspaces/create'
import {
  getWorkspaceCreationPolicy,
  WorkspaceCreationCapabilityWithheldError,
  WorkspaceCreationContextChangedError,
} from '@/lib/workspaces/policy'

interface CreatedProject {
  project: { id: string; name: string }
  initialEnvironment: { id: string; name: string }
}

export const createProject: OperationUseCase<
  typeof projectOperations.create,
  CreateProjectInput,
  CreatedProject
> = {
  operation: projectOperations.create,
  async execute({ principal, input, request }) {
    requireProjectPrincipal(principal, projectOperations.create)
    await requireProjectApiEnabled()
    const { organizationId, name, initialEnvironment } = input
    const policy = await getWorkspaceCreationPolicy({
      userId: principal.userId,
      activeOrganizationId: organizationId,
      pinOrganization: true,
    })
    if (!policy.canCreate) {
      if (policy.blockedReasonCode === 'permission-group-denied')
        refuseCapability('workspace.create')
      throw new OrchestrationError('forbidden', policy.reason ?? 'Project creation is not allowed')
    }
    if (policy.organizationId !== organizationId) {
      throw new OrchestrationError(
        'forbidden',
        'The requested organization cannot create environments under its current subscription'
      )
    }
    let created: Awaited<ReturnType<typeof createWorkspaceWithProjectInTransaction>>
    try {
      created = await db.transaction((tx) =>
        createWorkspaceWithProjectInTransaction(tx, {
          userId: principal.userId,
          name: initialEnvironment.name,
          projectName: name,
          organizationId,
          workspaceMode: policy.workspaceMode,
          billedAccountUserId: policy.billedAccountUserId,
          observedOrganizationId: policy.observedOrganizationId,
          governingPermissionGroupOrganizationId: policy.governingPermissionGroupOrganizationId,
        })
      )
    } catch (error) {
      if (error instanceof WorkspaceCreationCapabilityWithheldError)
        refuseCapability('workspace.create')
      if (error instanceof WorkspaceCreationContextChangedError)
        throw new OrchestrationError(
          'conflict',
          'Organization membership changed; retry Project creation'
        )
      if (getPostgresErrorCode(error) === '55P03')
        throw new OrchestrationError(
          'locked',
          'This organization is being updated; retry Project creation'
        )
      if (
        getPostgresErrorCode(error) === '23503' &&
        getPostgresConstraintName(error) === 'workspace_owner_id_user_id_fk'
      )
        throw new OrchestrationError('unauthorized', 'Unauthorized')
      if (
        getPostgresErrorCode(error) === '23503' &&
        getPostgresConstraintName(error) === 'workspace_billed_account_user_id_user_id_fk'
      )
        throw new OrchestrationError(
          'conflict',
          'The billing account changed; retry Project creation'
        )
      throw error
    }
    const environment = created.workspace
    emitWorkspaceCreatedPlatformEvent({
      workspaceId: environment.id,
      userId: principal.userId,
      name: environment.name,
    })
    recordProjectedUseCaseAuditEntries(
      projectOperations.create,
      environment.id,
      principal,
      request,
      [
        {
          action: AuditAction.PROJECT_CREATED,
          resourceType: AuditResourceType.PROJECT,
          resourceId: created.projectId,
          resourceName: name,
          description: `Created Project "${name}"`,
        },
        {
          action: AuditAction.WORKSPACE_CREATED,
          resourceType: AuditResourceType.WORKSPACE,
          resourceId: environment.id,
          resourceName: environment.name,
          description: `Created workspace "${environment.name}"`,
          metadata: { name: environment.name, workspaceMode: environment.workspaceMode },
        },
      ],
      organizationId ?? undefined
    )
    return {
      project: { id: created.projectId, name },
      initialEnvironment: { id: environment.id, name: environment.name },
    }
  },
}
