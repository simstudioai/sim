import { notFound, redirect } from 'next/navigation'
import { WorkspaceIntegrations } from '@/app/(product)/o/[organizationId]/integrations/_components/workspace-integrations/workspace-integrations'
import type { PlatformOrganization } from '@/platform/lib/data/organization-model'
import {
  appPagePath,
  findWorkspaceApp,
  readIntegrationsWorkspaceScope,
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
  const { workspaces, workspace, apps } = await readIntegrationsWorkspaceScope(
    organizationId,
    searchParams?.workspace
  )
  const detail = section ? findWorkspaceApp(apps, section) : undefined
  if (section && !detail) notFound()
  if (detail && section !== detail.id) redirect(appPagePath(organization, detail.id, searchParams))
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
