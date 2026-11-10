import { AuditAction, AuditResourceType } from '@sim/audit'
import type { SessionPrincipal } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { recordProjectedUseCaseAuditEntries } from '@/lib/core/application/authorized-workspace-use-case'
import {
  assertOperationPrincipal,
  defineOperation,
  type OperationUseCase,
} from '@/lib/core/application/operation'
import { requireOrganizationMembership } from '@/lib/core/application/organization-authorization'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { ensureViewerOrganization } from '@/lib/organizations/application/viewer-organization'
import { resolveSessionOrganizationLanding } from '@/lib/organizations/surface'
import { refuseCapability } from '@/lib/permission-groups/capabilities'
import { createWorkspace, listWorkspacesEnsuringDefault } from '@/lib/workspaces/create'
import type { CreateWorkspaceInput } from '@/lib/workspaces/create-input'
import { listWorkspacesForViewer, type WorkspaceListPayload } from '@/lib/workspaces/list'
import {
  getWorkspaceCreationPolicy,
  WorkspaceCreationCapabilityWithheldError,
  WorkspaceCreationContextChangedError,
} from '@/lib/workspaces/policy'
import type { WorkspaceScope } from '@/lib/workspaces/utils'

const logger = createLogger('ViewerWorkspaces')

const viewerWorkspaceOperations = {
  // permission-group-exempt: the signed-in person's own workspace list; a default workspace it creates is gated by `workspace.create` inside the creation policy
  list: defineOperation({
    id: 'workspaces.viewer.list',
    principalKinds: ['session'],
    capability: 'none',
  }),
  create: defineOperation({
    id: 'workspaces.viewer.create',
    principalKinds: ['session'],
    capability: 'workspace.create',
  }),
} as const

/**
 * The one organization a viewer's workspace list and creation are decided in: the one the caller
 * names (the shell's), once membership in it is confirmed, else the viewer's landing organization,
 * provisioned when they belong to none. Every caller — the shell's server render, the client's list
 * read and creation, and the `/workspace` entry — resolves it here, so the creation policy and
 * where a default workspace lands cannot differ between them.
 */
async function resolveViewerOrganizationId(
  principal: SessionPrincipal,
  organizationId: string | undefined
): Promise<string | null> {
  if (organizationId === undefined) {
    return ensureViewerOrganization.execute({ principal, input: {} })
  }
  await requireOrganizationMembership(principal, organizationId)
  return organizationId
}

/** A failed lookup leaves the viewer on the blocked picker rather than failing the list. */
async function resolveForwardOrganizationId(
  principal: SessionPrincipal
): Promise<string | undefined> {
  try {
    return (await resolveSessionOrganizationLanding(principal)) ?? undefined
  } catch (error) {
    logger.warn('Could not resolve an organization to forward a blocked viewer to', { error })
    return undefined
  }
}

interface ListViewerWorkspacesInput {
  scope: WorkspaceScope
  organizationId?: string
}

/**
 * The viewer's workspaces in `scope`. The active list creates their default workspace first when
 * they have none and may create one, and names the organization that can serve a viewer left with
 * nothing to pick.
 */
export const listViewerWorkspaces: OperationUseCase<
  typeof viewerWorkspaceOperations.list,
  ListViewerWorkspacesInput,
  WorkspaceListPayload & { forwardOrganizationId?: string }
> = {
  operation: viewerWorkspaceOperations.list,
  async execute({ principal, input }) {
    assertOperationPrincipal(principal, viewerWorkspaceOperations.list)
    const { userId } = principal
    const activeOrganizationId = await resolveViewerOrganizationId(principal, input.organizationId)
    if (input.scope !== 'active') {
      return listWorkspacesForViewer({ userId, activeOrganizationId, scope: input.scope })
    }
    const payload = await listWorkspacesEnsuringDefault({ userId, activeOrganizationId })
    if (payload.workspaces.length > 0 || payload.creationPolicy.canCreate) return payload
    return { ...payload, forwardOrganizationId: await resolveForwardOrganizationId(principal) }
  },
}

/** Creates a workspace for the viewer, in the organization {@link resolveViewerOrganizationId} decides. */
export const createViewerWorkspace: OperationUseCase<
  typeof viewerWorkspaceOperations.create,
  CreateWorkspaceInput & { organizationId?: string },
  Awaited<ReturnType<typeof createWorkspace>>
> = {
  operation: viewerWorkspaceOperations.create,
  async execute({ principal, input, request }) {
    assertOperationPrincipal(principal, viewerWorkspaceOperations.create)
    const { userId } = principal
    const activeOrganizationId = await resolveViewerOrganizationId(principal, input.organizationId)
    const policy = await getWorkspaceCreationPolicy({ userId, activeOrganizationId })
    if (!policy.canCreate) {
      if (policy.blockedReasonCode === 'permission-group-denied')
        refuseCapability('workspace.create')
      throw new OrchestrationError(
        'forbidden',
        policy.reason || 'Workspace creation is not available.'
      )
    }

    let created: Awaited<ReturnType<typeof createWorkspace>>
    try {
      created = await createWorkspace({
        userId,
        name: input.name,
        skipDefaultWorkflow: input.skipDefaultWorkflow,
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
          'Your organization membership changed while this workspace was being created. Please try again.'
        )
      throw error
    }

    recordProjectedUseCaseAuditEntries(
      viewerWorkspaceOperations.create,
      created.id,
      principal,
      request,
      [
        {
          action: AuditAction.WORKSPACE_CREATED,
          resourceType: AuditResourceType.WORKSPACE,
          resourceId: created.id,
          resourceName: created.name,
          description: `Created workspace "${created.name}"`,
          metadata: {
            name: created.name,
            workspaceMode: created.workspaceMode,
            organizationId: created.organizationId,
          },
        },
      ]
    )
    return created
  },
}
