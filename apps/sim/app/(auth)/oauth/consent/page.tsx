import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import type { SearchParams } from 'nuqs/server'
import { getSession } from '@/lib/auth'
import { isOAuthProviderEnabled } from '@/lib/core/config/env-flags'
import { AuthShell } from '@/app/(auth)/components'
import { OAuthConsentView } from '@/app/(auth)/oauth/consent/consent-view'
import { oauthConsentSearchParamsCache } from '@/app/(auth)/oauth/consent/search-params'

export const metadata: Metadata = {
  title: 'Authorize app',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

/**
 * The OAuth provider's `consentPage`. The plugin sends a signed-in user here with
 * the signed authorization query; the view shows who is asking and for what, and
 * the consent call carries that same query back so the plugin can mint a code
 * for exactly the request the user saw.
 *
 * A signed-out visitor (a stale tab, a shared link) goes through the same
 * bounce the plugin uses for its `loginPage`, which re-enters authorize after
 * sign-in and lands back here with a fresh signature.
 */
export default async function OAuthConsentPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  if (!isOAuthProviderEnabled) redirect('/')

  const [session, raw] = await Promise.all([getSession(), searchParams])

  if (!session?.user) {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === 'string') query.set(key, value)
    }
    redirect(`/oauth/sign-in?${query.toString()}`)
  }

  /**
   * Two ways a request can reach this page without Sim having authorized it,
   * both of which must refuse before anything is rendered.
   *
   * A repeated parameter is tampering, not a client quirk: the card names the
   * app and lists what it may do, and it reads those from the URL, where
   * `URLSearchParams.get` answers with the FIRST occurrence — so a link that
   * prepends its own `client_id` and `scope` would show a trustworthy app and
   * one harmless permission over somebody else's request.
   *
   * A missing `sig` means the query was never signed by the authorize
   * endpoint, so the whole thing is hand-written. Consent still fails at Allow
   * (the plugin refuses an unsigned `oauth_query`), but it fails with a
   * generic error, after the person has already read an authorization request
   * that Sim never issued. Both are caught here so the lie is never rendered.
   */
  const tampered = Object.values(raw).some((value) => Array.isArray(value))
  const unsigned = typeof raw.sig !== 'string'
  const refusal = tampered ? 'tampered' : unsigned ? 'unsigned' : null
  const params = refusal ? null : oauthConsentSearchParamsCache.parse(raw)

  return (
    <AuthShell>
      <OAuthConsentView
        refusal={refusal}
        clientId={params?.client_id ?? null}
        scope={params?.scope ?? null}
        redirectUri={params?.redirect_uri ?? null}
        email={session.user.email}
      />
    </AuthShell>
  )
}
