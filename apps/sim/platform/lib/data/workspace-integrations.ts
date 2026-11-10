import 'server-only'
import type { DehydratedState } from '@tanstack/react-query'
import { listWorkspaceApps } from '@/lib/catalog/application/list-workspace-apps'
import { asOrchestrationError } from '@/lib/core/orchestration/types'
import { canReadMemberIntegrations } from '@/lib/credential-groups/member-integrations-access'
import { getWorkspaceCredentialUseCase } from '@/lib/credentials/application/crud'
import { resolveIntegrationAccess } from '@/lib/integrations/access'
import { readWorkspaceShellResolver } from '@/lib/workspaces/application/workspace-shell'
import { listAccessibleWorkspaceRowsForUser } from '@/lib/workspaces/utils'
import { listRecentWorkspaceIds, sortByVisitRecency } from '@/lib/workspaces/visits'
import { readIntegrationLinks } from '@/platform/lib/data/integration-links'
import { type PlatformOrganization, surfaceHref } from '@/platform/lib/data/organization-model'
import { prefetchIntegrations } from '@/platform/lib/data/prefetch-integrations'
import { requireSessionViewer } from '@/platform/lib/data/server-read'
import type {
  WorkspaceApp,
  WorkspaceAppDetail,
} from '@/platform/lib/integrations/workspace-catalog'
import {
  findWorkspaceApp,
  projectWorkspaceApp,
} from '@/platform/lib/integrations/workspace-catalog'

type SearchParams = Record<string, string | string[] | undefined>

interface IntegrationsWorkspace {
  id: string
  name: string
}

/**
 * The viewer's workspaces whose credentials this organization's Integrations page manages: those
 * that open in this organization's shell. That is the organization's own, and any the viewer reaches
 * from outside it (organization-less ones, a guest's, an external collaborator's on another team's
 * workspace), which open in their landing organization, as `/workspace/<id>` URLs do. Most recently
 * visited first, as the workspace list orders them. It reads only the accessible rows and visit
 * order, not the list's invite flags and creation policy, and the viewer's memberships once.
 */
async function readIntegrationsWorkspaces(
  organizationId: string
): Promise<IntegrationsWorkspace[]> {
  const { principal } = await requireSessionViewer()
  const [rows, recentIds, shellOf] = await Promise.all([
    listAccessibleWorkspaceRowsForUser(principal.userId, 'active'),
    listRecentWorkspaceIds(principal.userId),
    readWorkspaceShellResolver(principal.userId),
  ])
  return sortByVisitRecency(
    rows.map(({ workspace }) => workspace),
    recentIds
  )
    .filter(
      (workspace) =>
        workspace.organizationId === organizationId ||
        shellOf(workspace.organizationId) === organizationId
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
      oauthAvailable: (providerId) => oauth.get(providerId.toLowerCase()) === true,
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
 * `workspace` that does not open in this organization is not found, never swapped for another; a
 * legacy slug canonicalizes to the app's id, and a link from before providers had pages to its
 * provider's page.
 */
export async function resolveIntegrationsSection(
  organization: PlatformOrganization,
  section: string | undefined,
  searchParams: SearchParams
): Promise<IntegrationsSection> {
  const member = canReadMemberIntegrations(organization)
  // Links name the index; a provider page reads only its own view state. The reads that do not
  // depend on one another start together.
  const [links, workspaces, state] = await Promise.all([
    member && !section ? readIntegrationLinks(organization, searchParams) : undefined,
    readIntegrationsWorkspaces(organization.organization.id),
    member ? prefetchIntegrations(organization) : undefined,
  ])
  if (links?.kind === 'invalid') return { kind: 'notFound' }
  if (links?.kind === 'redirect') return links
  const requested = Array.isArray(searchParams.workspace)
    ? searchParams.workspace[0]
    : searchParams.workspace
  const workspace =
    requested === undefined ? workspaces[0] : workspaces.find((item) => item.id === requested)
  if (requested !== undefined && !workspace) return { kind: 'notFound' }
  const apps = workspace ? await readWorkspaceApps(workspace.id) : []
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
  const detail = section ? findWorkspaceApp(apps, section) : undefined
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

/**
 * The provider of a workspace credential a legacy link names, `null` for one the viewer cannot read
 * (deleted, or not shared with them), which the link answers as not found, as its route does.
 */
async function readCredentialProvider(credentialId: string, workspaceId: string) {
  const { principal } = await requireSessionViewer()
  try {
    const { credential } = await getWorkspaceCredentialUseCase.execute({
      principal,
      input: { credentialId, assertedWorkspaceId: workspaceId },
    })
    return credential.providerId
  } catch (error) {
    const code = asOrchestrationError(error)?.code
    if (code === 'not_found' || code === 'forbidden') return null
    throw error
  }
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
