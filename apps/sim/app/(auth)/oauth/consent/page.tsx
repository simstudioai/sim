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
   * Repeated fields can make displayed consent diverge from the signed request;
   * unsigned requests never passed through the authorization endpoint.
   */
  const tampered = Object.entries(raw).some(
    ([key, value]) => key !== 'ba_param' && Array.isArray(value)
  )
  const unsigned = typeof raw.sig !== 'string'
  const expiresAtSeconds = typeof raw.exp === 'string' ? Number(raw.exp) : Number.NaN
  const expired = !Number.isFinite(expiresAtSeconds) || expiresAtSeconds * 1000 < Date.now()
  const refusal = tampered ? 'tampered' : unsigned ? 'unsigned' : expired ? 'expired' : null
  const params = refusal ? null : oauthConsentSearchParamsCache.parse(raw)
  const authorizationRequestKey = refusal ? null : JSON.stringify(raw)

  return (
    <AuthShell>
      <OAuthConsentView
        refusal={refusal}
        clientId={params?.client_id ?? null}
        authorizationRequestKey={authorizationRequestKey}
        scope={params?.scope ?? null}
        redirectUri={params?.redirect_uri ?? null}
        email={session.user.email}
      />
    </AuthShell>
  )
}
