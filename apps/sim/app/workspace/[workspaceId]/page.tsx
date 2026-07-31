import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { isChatEnabled } from '@/lib/core/config/env-flags'
import { getFirstWorkflowIdForWorkspace } from '@/lib/workflows/queries'
import { getWorkspaceHostContextForViewer } from '@/lib/workspaces/host-context'

/**
 * Resolves the workspace landing route. With Chat enabled that is the chat
 * composer; otherwise it is the workspace's first workflow, resolved here so the
 * browser makes a single server redirect instead of bouncing through `/w`, which
 * would mount a client component and flash a spinner before redirecting again.
 *
 * Access is checked before resolving: this page and the layout render
 * concurrently, so redirecting first would put a real workflow id in a
 * non-member's URL bar and history before the layout denies them. `getSession`
 * and `getWorkspaceHostContextForViewer` are both request-memoized, so the
 * checks are shared with the layout rather than duplicated.
 */
export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ workspaceId: string }>
}) {
  const { workspaceId } = await params

  if (isChatEnabled) {
    redirect(`/workspace/${workspaceId}/home`)
  }

  const session = await getSession()
  if (!session?.user) {
    redirect('/login')
  }

  const hostContext = await getWorkspaceHostContextForViewer(workspaceId, session.user.id)
  if (!hostContext) {
    // The layout renders WorkspaceAccessDenied for this case.
    return null
  }

  const workflowId = await getFirstWorkflowIdForWorkspace(workspaceId)
  redirect(workflowId ? `/workspace/${workspaceId}/w/${workflowId}` : `/workspace/${workspaceId}/w`)
}
