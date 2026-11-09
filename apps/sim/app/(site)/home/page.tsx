import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { WORKSPACES_PATH } from '@/lib/navigation/paths'
import { resolveAppEntryPath } from '@/lib/navigation/resolve-app-entry'

/**
 * The signed-in app's front door. Nothing renders here: the viewer is forwarded to
 * their organization's home, or to their workspaces when they belong to none. Every
 * default post-auth destination points at this route, so where a viewer lands is
 * decided once, on the server, with their membership in hand.
 */
export default async function AppEntryPage() {
  const session = await getSession()

  /**
   * A missing session here is never a signed-out visitor: the proxy treats `/home`
   * as an app surface and sends cookie-less requests to `/login` before this
   * renders, and auth-disabled deployments always resolve an anonymous session. So
   * this branch means the cookie is present but its session is gone — and
   * redirecting to `/login` would be bounced straight back by the proxy, which
   * reads cookie presence rather than validity, looping until the browser gives up.
   * Hand off to the workspace loader instead: it is the app's one identity-recovery
   * surface, and it clears the stale cookies through `recoverFromStaleSession`
   * before navigating to `/login`.
   */
  if (!session?.user) {
    redirect(WORKSPACES_PATH)
  }

  redirect(await resolveAppEntryPath(session))
}
