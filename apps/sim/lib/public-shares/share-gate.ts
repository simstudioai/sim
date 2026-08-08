import { createElement, type ReactNode } from 'react'
import { cookies } from 'next/headers'
import type { PublicShareKind } from '@/components/public-share'
import {
  PublicShareEmailAuth,
  PublicSharePasswordAuth,
  PublicShareSSOAuth,
} from '@/components/public-share'
import { getSession } from '@/lib/auth'
import {
  deploymentAuthCookieName,
  isEmailAllowed,
  validateAuthToken,
} from '@/lib/core/security/deployment'

/** The auth-relevant slice of a `public_share` row, for either resource family. */
export interface ShareGateRecord {
  id: string
  authType: string
  password: string | null
  allowedEmails: unknown
}

/**
 * The page-side auth gate for every public share surface: returns the prompt to
 * render when a protected share is not yet authorized, or `null` when the
 * visitor may use the resource.
 *
 * `password` and `email` are satisfied by the `{kind}_auth_{shareId}` cookie —
 * bound to the share id, the auth type, and a hash slot of the stored password,
 * so rotating the password or switching modes invalidates every live cookie.
 * `sso` deliberately ignores that cookie and instead requires a global Sim
 * session whose email is on the allow-list.
 *
 * This is the page-side counterpart of the API gate (`validateDeploymentAuth`),
 * which is a second, independent implementation of the same decision. Keeping
 * *one* page-side function across every share kind means the only pairing that
 * can drift is page-vs-API, rather than one such pairing per resource family.
 */
export async function resolvePublicShareGate(
  kind: PublicShareKind,
  token: string,
  share: ShareGateRecord
): Promise<ReactNode | null> {
  if (share.authType === 'public') return null

  if (share.authType === 'sso') {
    const session = await getSession()
    const allowedEmails = Array.isArray(share.allowedEmails)
      ? (share.allowedEmails as string[])
      : []
    const authorized = Boolean(
      session?.user?.email && isEmailAllowed(session.user.email, allowedEmails)
    )
    return authorized ? null : createElement(PublicShareSSOAuth, { token, kind })
  }

  const cookieStore = await cookies()
  const cookieValue = cookieStore.get(deploymentAuthCookieName(kind, share.id))?.value
  if (validateAuthToken(cookieValue ?? '', share.id, share.authType, share.password)) return null

  return share.authType === 'email'
    ? createElement(PublicShareEmailAuth, { token, kind })
    : createElement(PublicSharePasswordAuth, { token, kind })
}
