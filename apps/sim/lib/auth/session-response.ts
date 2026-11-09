import { getErrorMessage } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import { ApiClientError } from '@/lib/api/client/errors'

/**
 * The app-facing session shape derived from the Better Auth client response.
 * Lives here (the module that produces it) so both the `useSessionQuery` hook
 * and the `SessionProvider` can import it without a provider ↔ hook import cycle.
 */
export type AppSession = {
  user: {
    id: string
    email: string
    emailVerified?: boolean
    name?: string | null
    image?: string | null
    role?: string
    createdAt?: Date
    updatedAt?: Date
  } | null
  session?: {
    id?: string
    userId?: string
    activeOrganizationId?: string
    impersonatedBy?: string | null
  }
} | null

/**
 * Reads the organization plugin's `activeOrganizationId` off a session object
 * (server `getSession()` result or client {@link AppSession}). Better Auth's
 * inferred server session type does not declare the field, so this is the one
 * place the untyped read happens.
 */
export function getActiveOrganizationId(session: unknown): string | null {
  if (!isRecordLike(session) || !isRecordLike(session.session)) return null
  const value = session.session.activeOrganizationId
  return typeof value === 'string' ? value : null
}

/**
 * A server session cut down to {@link AppSession}'s fields, the only ones a page may hand the
 * browser. Everything else the server session carries stays out: the session token, IP address
 * and user agent, and user columns such as ban and billing state.
 */
export function toAppSession(session: unknown): AppSession {
  if (!isRecordLike(session) || !isRecordLike(session.user)) return null
  const { user } = session
  if (typeof user.id !== 'string' || typeof user.email !== 'string') return null
  const meta: Record<string, unknown> = isRecordLike(session.session) ? session.session : {}
  return {
    user: {
      id: user.id,
      email: user.email,
      ...(typeof user.emailVerified === 'boolean' && { emailVerified: user.emailVerified }),
      ...((typeof user.name === 'string' || user.name === null) && { name: user.name }),
      ...((typeof user.image === 'string' || user.image === null) && { image: user.image }),
      ...(typeof user.role === 'string' && { role: user.role }),
      ...(user.createdAt instanceof Date && { createdAt: user.createdAt }),
      ...(user.updatedAt instanceof Date && { updatedAt: user.updatedAt }),
    },
    session: {
      ...(typeof meta.id === 'string' && { id: meta.id }),
      ...(typeof meta.userId === 'string' && { userId: meta.userId }),
      ...(typeof meta.activeOrganizationId === 'string' && {
        activeOrganizationId: meta.activeOrganizationId,
      }),
      ...((typeof meta.impersonatedBy === 'string' || meta.impersonatedBy === null) && {
        impersonatedBy: meta.impersonatedBy,
      }),
    },
  }
}

interface BetterAuthErrorEnvelope {
  data: null
  error: {
    message?: string
    status: number
    statusText: string
  }
}

function isBetterAuthErrorEnvelope(result: unknown): result is BetterAuthErrorEnvelope {
  if (!isRecordLike(result) || result.data !== null || !isRecordLike(result.error)) {
    return false
  }

  return (
    typeof result.error.status === 'number' &&
    typeof result.error.statusText === 'string' &&
    (result.error.message === undefined || typeof result.error.message === 'string')
  )
}

export function extractSessionDataFromAuthClientResult(result: unknown): unknown | null {
  if (isBetterAuthErrorEnvelope(result)) {
    const fallback =
      result.error.statusText || `Better Auth session request failed (${result.error.status})`
    throw new ApiClientError({
      status: result.error.status,
      message: getErrorMessage(result.error.message, fallback),
      body: result.error,
    })
  }

  if (!isRecordLike(result)) {
    return null
  }

  // Expected shape from better-auth client: { data: <session> }
  if ('data' in result) {
    return result.data ?? null
  }

  // Fallback for raw session payloads: { user, session }
  if ('user' in result) {
    return result
  }

  return null
}
