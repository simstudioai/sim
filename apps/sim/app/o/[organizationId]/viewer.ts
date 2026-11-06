import type { SessionPrincipal } from '@sim/auth/principal'
import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { getOrganizationSurfaceGate } from '@/lib/organizations/surface'
import { buildAuthCrossLink } from '@/app/(auth)/auth-redirect'

/**
 * Every organization page's gate. Signed out goes to sign-in and comes back to `callbackUrl`; signed
 * in without access to this organization is a 404, so a private organization's existence never shows.
 */
export async function requireOrganizationViewer(organizationId: string, callbackUrl: string) {
  const session = await getSession()
  if (!session?.user?.id) {
    redirect(buildAuthCrossLink('/login', { callbackUrl, isInviteFlow: false }))
  }
  const surface = await getOrganizationSurfaceGate(organizationId, session.user.id)
  if (!surface) notFound()
  const principal: SessionPrincipal = {
    kind: 'session',
    userId: session.user.id,
    sessionId: session.session.id,
  }
  return { userId: session.user.id, principal, surface }
}
