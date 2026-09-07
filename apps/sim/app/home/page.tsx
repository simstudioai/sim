import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { resolveAppEntryPath } from '@/lib/navigation/resolve-app-entry'

/**
 * The signed-in app's front door. Nothing renders here: the viewer is forwarded to
 * their organization's home, or to their workspaces when they belong to none. Every
 * default post-auth destination points at this route, so where a viewer lands is
 * decided once, on the server, with their membership in hand.
 */
export default async function AppEntryPage() {
  const session = await getSession()
  if (!session?.user) {
    redirect('/login')
  }

  redirect(await resolveAppEntryPath(session))
}
