import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import type { SearchParams } from 'nuqs/server'
import { getSession } from '@/lib/auth'
import { isOAuthProviderEnabled } from '@/lib/auth/oauth-provider-feature'
import { OAuthConsentView } from '@/app/(auth)/oauth/consent/consent-view'
import { oauthConsentSearchParamsCache } from '@/app/(auth)/oauth/consent/search-params'

export const metadata: Metadata = {
  title: 'Authorize app',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

/**
 * Renders the plugin's signed request; signed-out visitors restart through the
 * login bridge to obtain a fresh authorization query.
 */
export default async function OAuthConsentPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  if (!(await isOAuthProviderEnabled())) redirect('/')

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
    <div className='[overflow-wrap:anywhere]'>
      <OAuthConsentView
        refusal={refusal}
        clientId={params?.client_id ?? null}
        authorizationRequestKey={authorizationRequestKey}
        scope={params?.scope ?? null}
        redirectUri={params?.redirect_uri ?? null}
        email={session.user.email}
      />
    </div>
  )
}
