import { EmptyState } from '@sim/emcn/empty-state'
import { notFound } from 'next/navigation'
import {
  readWorkspacePlanManager,
  redirectLegacyWorkspaceUrl,
} from '@/platform/lib/data/legacy-redirects'
import { resolvePlatformMode } from '@/platform/lib/data/mode'

/**
 * Plans belong to the organization's billing, so the usage limit that sent the viewer here goes
 * along. A viewer who cannot change the workspace's plan is told who can instead of being sent to
 * plans that are not this workspace's.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (resolvePlatformMode() !== 'live') notFound()
  const [{ workspaceId }, query] = await Promise.all([params, searchParams])
  const manager = await readWorkspacePlanManager(workspaceId)
  if (manager) {
    return (
      <EmptyState
        title='Workspace plans unavailable'
        description={
          manager.managedBy === 'organization'
            ? `Plans for ${manager.workspaceName} are managed by its organization administrators. Contact an organization admin to change this workspace’s plan.`
            : `Only the owner of ${manager.workspaceName} can change this workspace’s plan.`
        }
      />
    )
  }
  return redirectLegacyWorkspaceUrl(workspaceId, ['upgrade'], query)
}
