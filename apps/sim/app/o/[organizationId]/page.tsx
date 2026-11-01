import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { organizationRoutes, WORKSPACE_SETTINGS_PATH } from '@/lib/navigation/paths'
import { getOrganizationSurfaceContext } from '@/lib/organizations/surface'
import { canBrowsePeople } from '@/lib/people/feature-flag'
import { isSimLinksEnabled } from '@/lib/sim-links/feature-flag'
import { buildAuthCrossLink } from '@/app/(auth)/auth-redirect'

export default async function OrganizationPage({
  params,
}: {
  params: Promise<{ organizationId: string }>
}) {
  const { organizationId } = await params
  const routes = organizationRoutes(organizationId)
  const session = await getSession()
  if (!session?.user?.id) {
    redirect(buildAuthCrossLink('/login', { callbackUrl: routes.root, isInviteFlow: false }))
  }
  const context = await getOrganizationSurfaceContext(organizationId, session.user.id)
  if (!context) notFound()
  if (context.mothershipAvailable && context.canBuild) redirect(routes.home)
  if (context.searchAccess.memberScoped) redirect(routes.search)
  if (await canBrowsePeople(organizationId, context.viewer.role)) redirect(routes.people)
  redirect((await isSimLinksEnabled(organizationId)) ? routes.simLinks : WORKSPACE_SETTINGS_PATH)
}
