import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { resolveAppEntryPath } from '@/lib/navigation/resolve-app-entry'

/**
 * Bare `/o` has no organization to show, so it resolves exactly like the app entry:
 * the viewer's organization home, or their workspaces when they belong to none.
 */
export default async function OrganizationIndexPage() {
  const session = await getSession()
  if (!session?.user) {
    redirect('/login')
  }

  redirect(await resolveAppEntryPath(session))
}
