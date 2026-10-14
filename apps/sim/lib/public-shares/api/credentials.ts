import type { SessionPrincipal } from '@sim/auth/principal'
import { getSession } from '@/lib/auth'

/** Authenticate the optional browser session without substituting the file creator for its caller. */
export async function publicFileShareCredential(
  cookies: readonly { name: string; value: string }[],
  clientIp?: string | null
) {
  const session = await getSession()
  let sessionPrincipal: SessionPrincipal | undefined
  if (session?.user?.id) {
    const sessionId = session.session?.id
    if (!sessionId) throw new Error('Authenticated session is missing its session ID')
    sessionPrincipal = { kind: 'session', userId: session.user.id, sessionId }
  }
  return {
    method: 'GET' as const,
    cookies: Object.fromEntries(cookies.map(({ name, value }) => [name, value])),
    sessionPrincipal,
    clientIp,
  }
}
