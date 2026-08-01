import { redirect } from 'next/navigation'
import { isChatEnabled } from '@/lib/core/config/env-flags'

/**
 * Resolves the workspace landing route: the chat composer, or `/w`, which
 * selects the first workflow from the list the layout already prefetched.
 *
 * Deliberately does no work of its own. Resolving the workflow here would mean
 * a session lookup, an access check, and a query before anything renders — and
 * a slow database would leave the user on a blank page instead of a redirect,
 * since there is nothing to show until all three finish.
 */
export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ workspaceId: string }>
}) {
  const { workspaceId } = await params
  redirect(`/workspace/${workspaceId}/${isChatEnabled ? 'home' : 'w'}`)
}
