import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { resolveWorkspacelessMemberPath } from '@/lib/navigation/resolve-app-entry'
import { WorkspaceEntry } from '@/app/workspace/workspace-entry'

const logger = createLogger('WorkspacePage')

interface WorkspacePageProps {
  searchParams: Promise<{ redirect?: string | string[] }>
}

/**
 * The workspace picker. An organization member with no workspace to pick is forwarded
 * to their organization before the picker renders. Everyone else, including a stale
 * session and a failed lookup, gets {@link WorkspaceEntry}: it is the app's one
 * identity-recovery surface, so a failure here must never replace it with an error page.
 */
export default async function WorkspacePage({ searchParams }: WorkspacePageProps) {
  const { redirect: redirectTarget } = await searchParams
  let forwardPath: string | null = null
  try {
    const session = await getSession()
    if (session?.user) {
      forwardPath = await resolveWorkspacelessMemberPath(
        session,
        redirectTarget === 'settings' ? 'settings' : 'home'
      )
    }
  } catch (error) {
    logger.warn('Could not resolve a workspaceless member destination', {
      error: getErrorMessage(error),
    })
  }
  if (forwardPath) redirect(forwardPath)

  return <WorkspaceEntry />
}
