import { EmptyState } from '@sim/emcn/empty-state'
import { notFound } from 'next/navigation'
import { canManageWorkspaceBilling } from '@/lib/billing/workspace-permissions'
import { decodePathSegments } from '@/lib/navigation/paths'
import { getWorkspaceHostContextForViewer } from '@/lib/workspaces/host-context'
import { resolvePlatformMode } from '@/platform/lib/data/mode'
import { requireSessionViewer } from '@/platform/lib/data/server-read'

/**
 * Plans belong to the organization's billing, so the usage limit that sent the viewer here goes
 * along. A viewer who cannot change the workspace's plan (it bills another account, or an
 * organization they do not administer) is told who can, as the legacy upgrade page did, instead of
 * being sent to plans that are not this workspace's. Fixture servers have no workspace to resolve.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (resolvePlatformMode() !== 'live') notFound()
  const [{ workspaceId: encodedWorkspaceId }, query] = await Promise.all([params, searchParams])
  const [workspaceId] = decodePathSegments([encodedWorkspaceId]) ?? []
  if (!workspaceId) notFound()
  const { principal } = await requireSessionViewer()
  const hostContext = await getWorkspaceHostContextForViewer(workspaceId, principal.userId)
  if (hostContext && !canManageWorkspaceBilling(hostContext, principal.userId)) {
    const { name } = hostContext.workspace
    return (
      <EmptyState
        title='Workspace plans unavailable'
        description={
          hostContext.hostOrganizationId
            ? `Plans for ${name} are managed by its organization administrators. Contact an organization admin to change this workspace’s plan.`
            : `Only the owner of ${name} can change this workspace’s plan.`
        }
      />
    )
  }
  const { redirectLegacyWorkspaceUrl } = await import('@/platform/lib/data/legacy-redirects')
  return redirectLegacyWorkspaceUrl(encodedWorkspaceId, ['upgrade'], query)
}
