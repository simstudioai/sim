import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { organizationRoutes } from '@/lib/navigation/paths'
import { getOrganizationSurfaceContext } from '@/lib/organizations/surface'
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
  redirect(context.searchAccess.memberScoped ? routes.home : routes.settingsSection('members'))
}
