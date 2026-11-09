import { notFound, redirect } from 'next/navigation'
import { WorkspaceIntegrations } from '@/app/(product)/o/[organizationId]/integrations/_components/workspace-integrations/workspace-integrations'
import { type PlatformOrganization, surfaceHref } from '@/platform/lib/data/organization-model'
import {
  readIntegrationsWorkspaces,
  readWorkspaceApps,
  toAppSummaries,
} from '@/platform/lib/data/workspace-integrations'

interface LiveWorkspaceIntegrationsRouteProps {
  organization: PlatformOrganization
  /** The `/integrations/[app]` segment; absent on the index. */
  section?: string
  searchParams?: Record<string, string | string[] | undefined>
}

/**
 * Integrations for an organization without member-scoped accounts: the viewer's workspace credentials
 * and skills, one workspace at a time. The server judges which apps the chosen workspace may use, so
 * choosing another workspace reloads that verdict.
 */
export async function LiveWorkspaceIntegrationsRoute({
  organization,
  section,
  searchParams,
}: LiveWorkspaceIntegrationsRouteProps) {
  const organizationId = organization.organization.id
  const workspaces = await readIntegrationsWorkspaces(organizationId)
  const requested = searchParams?.workspace
  const workspace =
    workspaces.find((item) => item.id === (Array.isArray(requested) ? requested[0] : requested)) ??
    workspaces[0]
  const apps = workspace ? await readWorkspaceApps(workspace.id) : []
  const detail = section
    ? apps.find((app) => app.id === section || app.slug === section)
    : undefined
  if (section && !detail) notFound()
  // A legacy link names an app by its old slug; its page lives at the catalog id.
  if (detail && section !== detail.id) {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(searchParams ?? {}))
      for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value])
        query.append(key, item)
    const path = surfaceHref(organization, `/integrations/${encodeURIComponent(detail.id)}`)
    redirect(query.size ? `${path}?${query}` : path)
  }
  return (
    <WorkspaceIntegrations
      organizationId={organizationId}
      workspaces={workspaces}
      workspaceId={workspace?.id ?? null}
      apps={toAppSummaries(apps)}
      detail={detail}
    />
  )
}
