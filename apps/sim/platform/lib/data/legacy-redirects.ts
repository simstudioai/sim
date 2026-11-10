import 'server-only'
import { notFound, permanentRedirect } from 'next/navigation'
import { canManageWorkspaceBilling } from '@/lib/billing/workspace-permissions'
import { mapLegacyWorkspaceUrl } from '@/lib/navigation/legacy-redirects'
import { decodePathSegments, searchParamsQuery } from '@/lib/navigation/paths'
import { getWorkspaceHostContextForViewer } from '@/lib/workspaces/host-context'
import { requireSessionViewer } from '@/platform/lib/data/server-read'
import { readWorkspaceShellOrganizationId } from '@/platform/lib/data/shell-scope'

/**
 * The body of every page that serves a moved workspace URL: the route table's legacy workspace rule
 * (`mapLegacyWorkspaceUrl`, which `resolveProductRedirect` runs for the same path) answers with a
 * permanent redirect to the page in the organization the workspace renders in. A workspace the
 * viewer cannot open, or a path with no new home, is not found, so a private workspace's
 * organization never shows. The page passes its route params as Next hands them, still
 * percent-encoded; they are decoded once here, and the route builders encode them once.
 */
export async function redirectLegacyWorkspaceUrl(
  encodedWorkspaceId: string,
  encodedSegments: readonly string[],
  searchParams: Record<string, string | string[] | undefined>
): Promise<never> {
  const decoded = decodePathSegments([encodedWorkspaceId, ...encodedSegments])
  if (!decoded) notFound()
  const [workspaceId, ...segments] = decoded
  const target = mapLegacyWorkspaceUrl({
    workspaceId,
    segments,
    query: searchParamsQuery(searchParams),
    organizationId: await readWorkspaceShellOrganizationId(workspaceId),
  })
  if (!target) notFound()
  permanentRedirect(target)
}

/** Who may change a workspace's plan, when the viewer may not: its organization's admins, or its owner. */
export type WorkspacePlanManager = { workspaceName: string; managedBy: 'organization' | 'owner' }

/**
 * Whether the viewer may change this workspace's plan. `null` sends them on to plans; otherwise the
 * workspace bills an account they do not manage, and they are told who does, as the legacy upgrade
 * page did, instead of opening plans that are not this workspace's.
 */
export async function readWorkspacePlanManager(
  encodedWorkspaceId: string
): Promise<WorkspacePlanManager | null> {
  const [workspaceId] = decodePathSegments([encodedWorkspaceId]) ?? []
  if (!workspaceId) notFound()
  const { principal } = await requireSessionViewer()
  const hostContext = await getWorkspaceHostContextForViewer(workspaceId, principal.userId)
  if (!hostContext || canManageWorkspaceBilling(hostContext, principal.userId)) return null
  return {
    workspaceName: hostContext.workspace.name,
    managedBy: hostContext.hostOrganizationId ? 'organization' : 'owner',
  }
}
