import 'server-only'
import type { DehydratedState } from '@tanstack/react-query'
import { getWorkspaceCredentialContract } from '@/lib/api/contracts/credentials'
import { listWorkspacesContract } from '@/lib/api/contracts/workspaces'
import { listWorkspaceApps } from '@/lib/catalog/application/list-workspace-apps'
import { resolveIntegrationAccess } from '@/lib/integrations/access'
import { getWorkspaceCredentialUseCase } from '@/lib/credentials/application/crud'
import { toWorkspaceCredential } from '@/lib/credentials/application/presentation'
import { listWorkspacesForViewer } from '@/lib/workspaces/list'
import { readIntegrationLinks } from '@/platform/lib/data/integration-links'
import { hasMemberIntegrations } from '@/platform/lib/data/member-integrations'
import { type PlatformOrganization, surfaceHref } from '@/platform/lib/data/organization-model'
import { prefetchIntegrations } from '@/platform/lib/data/prefetch-integrations'
import { asRouteResponse, requireSessionViewer } from '@/platform/lib/data/server-read'
import type {
  WorkspaceApp,
  WorkspaceAppDetail,
} from '@/platform/lib/integrations/workspace-catalog'
import { projectWorkspaceApp } from '@/platform/lib/integrations/workspace-catalog'

type SearchParams = Record<string, string | string[] | undefined>


interface IntegrationsWorkspace {
  id: string
  name: string
}

/**
 * The viewer's workspaces whose credentials this organization's Integrations page manages: the
 * organization's own, and organization-less ones, which render in whichever organization they open.
 * Most recently visited first, as the workspace list orders them.
 */
async function readIntegrationsWorkspaces(
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
 * The apps the viewer may see in one workspace, each judged by the access policy the catalog's
 * workspace-apps use case resolves, projected from the generated catalog.
 */
async function readWorkspaceApps(workspaceId: string): Promise<WorkspaceAppDetail[]> {
  const { principal } = await requireSessionViewer()
  const { integrationCatalog } = await import('@/platform/lib/integrations/catalog.generated')
  const { policy, oauthAvailability } = await listWorkspaceApps.execute({
    principal,
    input: { workspaceId },
  })
  const oauth = new Map(
    oauthAvailability.map(({ providerId, available }) => [providerId.toLowerCase(), available])
  )
  return integrationCatalog.flatMap((entry) => {
    const app = projectWorkspaceApp(entry, {
      access: (blockType) => resolveIntegrationAccess(blockType, policy),
      oauthAvailable: (providerId) => oauth.get(providerId.toLowerCase()),
    })
    return app
      ? [{ ...app, example: entry.example, skills: entry.skills, templates: entry.templates }]
      : []
  })
}

/** What an Integrations URL shows, decided once on the server for the page that renders it. */
export type IntegrationsSection =
  | { kind: 'redirect'; href: string }
  | { kind: 'notFound' }
  | {
      kind: 'render'
      /** Whether the organization keeps member-scoped accounts the viewer may connect. */
      member: boolean
      links?: Extract<Awaited<ReturnType<typeof readIntegrationLinks>>, { kind: 'page' }>
      workspaces: IntegrationsWorkspace[]
      /** The workspace every tab lists within; absent when the viewer has none. */
      workspaceId: string | null
      apps: WorkspaceApp[]
      /** The app the `[app]` segment names in that workspace's catalog. */
      detail?: WorkspaceAppDetail
      state?: DehydratedState
    }

/**
 * Decides what an Integrations URL shows: the index or an app page over the member's own accounts,
 * where the organization keeps them, and one workspace's catalog, credentials and skills. A
 * `workspace` the viewer cannot list canonicalizes to their first workspace, a legacy slug to the
 * app's id, and a link from before providers had pages to its provider's page.
 */
export async function resolveIntegrationsSection(
  organization: PlatformOrganization,
  section: string | undefined,
  searchParams: SearchParams
): Promise<IntegrationsSection> {
  const member = hasMemberIntegrations(organization)
  // Links name the index; a provider page reads only its own view state.
  const links =
    member && !section ? await readIntegrationLinks(organization, searchParams) : undefined
  if (links?.kind === 'invalid') return { kind: 'notFound' }
  if (links?.kind === 'redirect') return links
  const workspaces = await readIntegrationsWorkspaces(organization.organization.id)
  const requested = Array.isArray(searchParams.workspace)
    ? searchParams.workspace[0]
    : searchParams.workspace
  const workspace =
    requested === undefined ? workspaces[0] : workspaces.find((item) => item.id === requested)
  if (requested !== undefined && !workspace)
    return {
      kind: 'redirect',
      href: integrationsPath(organization, section, {
        ...searchParams,
        workspace: workspaces[0]?.id,
      }),
    }
  const [apps, state] = await Promise.all([
    workspace ? readWorkspaceApps(workspace.id) : [],
    member ? prefetchIntegrations(organization) : undefined,
  ])
  // A legacy connected-credential link names only the credential: open it in its app's page.
  const legacyAccount = Array.isArray(searchParams.account)
    ? searchParams.account[0]
    : searchParams.account
  if (!member && !section && workspace && legacyAccount) {
    const providerId = await readCredentialProvider(legacyAccount, workspace.id)
    const app = providerId && apps.find((item) => item.credentialProviders.includes(providerId))
    return app
      ? { kind: 'redirect', href: integrationsPath(organization, app.id, searchParams) }
      : { kind: 'notFound' }
  }
  const detail = section
    ? apps.find((app) => app.id === section || app.slug === section)
    : undefined
  if (detail && section !== detail.id)
    return { kind: 'redirect', href: integrationsPath(organization, detail.id, searchParams) }
  // A member integration is read in the browser, so only an organization without one can tell here.
  if (section && !detail && !member) return { kind: 'notFound' }
  return {
    kind: 'render',
    member,
    links,
    workspaces,
    workspaceId: workspace?.id ?? null,
    apps: apps.map(({ example, skills, templates, ...app }) => app),
    detail,
    state,
  }
}

/** The provider of a workspace credential a legacy link names, read as its route reads it. */
async function readCredentialProvider(credentialId: string, workspaceId: string) {
  const { principal } = await requireSessionViewer()
  const { credential, access } = await getWorkspaceCredentialUseCase.execute({
    principal,
    input: { credentialId, assertedWorkspaceId: workspaceId },
  })
  const response = await asRouteResponse(getWorkspaceCredentialContract, {
    credential: toWorkspaceCredential(credential, access),
  })
  return response.credential?.providerId ?? null
}

/** An Integrations page with the query it was asked for. */
function integrationsPath(
  organization: PlatformOrganization,
  section: string | undefined,
  searchParams: SearchParams
) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(searchParams))
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value])
      query.append(key, item)
  const path = surfaceHref(
    organization,
    section ? `/integrations/${encodeURIComponent(section)}` : '/integrations'
  )
  return query.size ? `${path}?${query}` : path
}
