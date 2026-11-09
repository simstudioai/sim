import 'server-only'
import { cache } from 'react'
import type { SessionPrincipal } from '@sim/auth/principal'
import { readContractResponse } from '@/lib/api/client/request'
import type { AnyApiRouteContract, ContractJsonResponse } from '@/lib/api/contracts'
import { getSession } from '@/lib/auth'
import { getActiveOrganizationId } from '@/lib/auth/session-response'
import { withinDeadline } from '@/lib/core/utils/deadline'

/** A slow read gives up its first-paint seat rather than hold the document; the client fetches it. */
const PREFETCH_TIMEOUT_MS = 2_000

interface SessionViewer {
  principal: SessionPrincipal
  /** The session's active organization, which scopes the workspace list as its route does. */
  activeOrganizationId: string | null
}

/** The signed-in viewer, read once per request. `null` when signed out. */
export const readSessionViewer = cache(async (): Promise<SessionViewer | null> => {
  const session = await getSession()
  if (!session?.user?.id) return null
  return {
    principal: { kind: 'session', userId: session.user.id, sessionId: session.session.id },
    activeOrganizationId: getActiveOrganizationId(session),
  }
})

/**
 * The viewer for a read under the shell, which answers a signed-out request before any page reads.
 */
export async function requireSessionViewer(): Promise<SessionViewer> {
  const viewer = await readSessionViewer()
  if (!viewer) throw new Error('A Platform server read ran without a session')
  return viewer
}

/**
 * A use case's result as its route sends it, read back the way `requestJson` reads the wire: dates
 * become strings, and a result that has drifted from the route contract fails here.
 */
export function asRouteResponse<C extends AnyApiRouteContract>(
  contract: C,
  body: unknown
): Promise<ContractJsonResponse<C>> {
  return readContractResponse(contract, Response.json(body))
}

/** Bounds a first-paint read, which must never hold the document. */
export function withinPrefetchBudget<T>(read: () => Promise<T>): Promise<T> {
  return withinDeadline(read, Date.now() + PREFETCH_TIMEOUT_MS)
}
