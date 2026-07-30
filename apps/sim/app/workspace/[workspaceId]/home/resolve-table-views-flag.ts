import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import { getWorkspaceHostContextForViewer } from '@/lib/workspaces/host-context'

/**
 * Resolves `table-views` for the mothership panel's embedded table.
 *
 * Lives here rather than inline because BOTH routes that render `<Home>` need it
 * — `home/page.tsx` and `chat/[chatId]/page.tsx` — and the flag can only be read
 * server-side (its gating is in AppConfig, which has no client counterpart).
 * Resolving it in one place is what keeps the two routes from drifting; the chat
 * route missing it is precisely why views didn't appear in the panel.
 *
 * Keyed on the workspace's HOST organization, matching the table page, so the
 * same workspace gates identically wherever its tables are rendered. Both this
 * and `getSession` are request-memoized, so callers pay no extra round-trip.
 */
export async function resolveTableViewsEnabled(
  workspaceId: string,
  userId: string | undefined
): Promise<boolean> {
  const host = userId ? await getWorkspaceHostContextForViewer(workspaceId, userId) : null
  return isFeatureEnabled('table-views', {
    userId,
    orgId: host?.hostOrganizationId ?? undefined,
  })
}
