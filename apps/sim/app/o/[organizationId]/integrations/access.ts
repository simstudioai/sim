import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { getOrganizationSurfaceContext } from '@/lib/organizations/surface'
import { buildAuthCrossLink } from '@/app/(auth)/auth-redirect'

/**
 * The gate the integrations index and provider pages share. `callbackUrl` is the page to come back to after
 * sign-in, carrying whatever connection or Slack context the visit arrived with.
 */
export async function requireIntegrationsViewer(organizationId: string, callbackUrl: string) {
  const session = await getSession()
  if (!session?.user) redirect(buildAuthCrossLink('/login', { callbackUrl, isInviteFlow: false }))
  const context = await getOrganizationSurfaceContext(organizationId, session.user.id)
  if (!context?.searchAccess.memberScoped) notFound()
  return session.user.id
}
