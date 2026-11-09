import 'server-only'
import { createLogger } from '@sim/logger'
import { listWorkspacesContract } from '@/lib/api/contracts/workspaces'
import { getBlockVisibility } from '@/lib/core/config/block-visibility'
import { createIntegrationAccessPolicy, resolveIntegrationAccess } from '@/lib/integrations/access'
import { readIntegrationAvailability } from '@/lib/integrations/application/read-availability'
import { readUserPermissionConfig } from '@/lib/permission-groups/application/read-user-config'
import { isPlatformAdmin } from '@/lib/permissions/super-user'
import { listWorkspacesForViewer } from '@/lib/workspaces/list'
import { asRouteResponse, requireSessionViewer } from '@/platform/lib/data/server-read'
import type {
  WorkspaceApp,
  WorkspaceAppDetail,
} from '@/platform/lib/integrations/workspace-catalog'
import { projectWorkspaceApp } from '@/platform/lib/integrations/workspace-catalog'

const logger = createLogger('PlatformWorkspaceIntegrations')

export interface IntegrationsWorkspace {
  id: string
  name: string
}

/**
 * The viewer's workspaces whose credentials this organization's Integrations page manages: the
 * organization's own, and organization-less ones, which render in whichever organization they open.
 * Most recently visited first, as the workspace list orders them.
 */
export async function readIntegrationsWorkspaces(
  organizationId: string
): Promise<IntegrationsWorkspace[]> {
  const { principal, activeOrganizationId } = await requireSessionViewer()
  const { workspaces } = await asRouteResponse(
    listWorkspacesContract,
    await listWorkspacesForViewer({ userId: principal.userId, activeOrganizationId })
  )
  return workspaces
    .filter(
      (workspace) =>
        workspace.organizationId === organizationId || workspace.organizationId === null
    )
    .map((workspace) => ({ id: workspace.id, name: workspace.name }))
}

/**
 * The apps the viewer may see in one workspace, judged by the same integration access policy the
 * workflow editor's pickers apply: the workspace's permission group, the deployment's allowlist and
 * configuration, and the viewer's block visibility. Each input is read through the use case its
 * route runs, with the viewer's session.
 */
export async function readWorkspaceApps(workspaceId: string): Promise<WorkspaceAppDetail[]> {
  const { principal } = await requireSessionViewer()
  const [permission, availability, { integrationCatalog }] = await Promise.all([
    readUserPermissionConfig.execute({ principal, input: { workspaceId } }),
    readIntegrationAvailability.execute({ principal, input: undefined }),
    import('@/platform/lib/integrations/catalog.generated'),
  ])
  const visibility = await getBlockVisibility({
    userId: principal.userId,
    orgId: permission.organizationId ?? undefined,
    isAdmin: await isPlatformAdmin(principal.userId).catch((error: unknown) => {
      logger.warn('Could not resolve platform administration for block visibility', { error })
      return false
    }),
  })
  const policy = createIntegrationAccessPolicy({
    groupConfig: permission.config,
    groupAllowlist: permission.config?.allowedIntegrations ?? null,
    deploymentAllowlist: availability.allowedIntegrations,
    availability: availability.integrationAvailability,
    visibility,
    credentialGroupsEnabled: false,
  })
  const oauth = new Map(
    availability.oauthServiceAvailability.map(({ providerId, available }) => [
      providerId.toLowerCase(),
      available,
    ])
  )
  return integrationCatalog.flatMap((entry) => {
    const app = projectWorkspaceApp(entry, {
      access: (blockType) => resolveIntegrationAccess(blockType, policy),
      oauthAvailable: (providerId) => oauth.get(providerId.toLowerCase()),
    })
    return app ? [{ ...app, example: entry.example }] : []
  })
}

/** The directory's apps, without the copy only a detail page shows. */
export function toAppSummaries(apps: readonly WorkspaceAppDetail[]): WorkspaceApp[] {
  return apps.map((detail) => {
    const { example, ...app } = detail
    return app
  })
}
