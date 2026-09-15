import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { resolveIdpInitiatedLoginProvider } from '@/lib/auth/sso/idp-initiated-login'
import { isSsoEnabled } from '@/lib/core/config/env-flags'
import { DEFAULT_POST_AUTH_ROUTE } from '@/app/(auth)/auth-redirect'
import { SSOLaunch } from '@/ee/sso/components/sso-launch'

export const metadata: Metadata = {
  title: 'Single Sign-On',
}

export const dynamic = 'force-dynamic'

interface SSOLaunchPageProps {
  params: Promise<{ providerId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/**
 * The initiate login URL an identity provider's app dashboard opens (OpenID Connect third-party
 * initiated login). The dashboard adds its issuer as `iss`, so the URL carries no query of its own.
 * Someone already signed in goes straight to the app, so a link cannot replace their session. When
 * the issuer is the provider's own, sign-in starts through it at once; otherwise the visitor gets the
 * provider's ordinary sign-in link, which asks for an email.
 */
export default async function SSOLaunchPage({ params, searchParams }: SSOLaunchPageProps) {
  if (!isSsoEnabled) {
    redirect('/login')
  }

  const [session, { providerId }, { iss }] = await Promise.all([getSession(), params, searchParams])
  if (session?.user) {
    redirect(DEFAULT_POST_AUTH_ROUTE)
  }

  const launchProviderId =
    typeof iss === 'string' ? await resolveIdpInitiatedLoginProvider(providerId, iss) : null
  if (!launchProviderId) {
    redirect(`/sso?provider=${encodeURIComponent(providerId)}`)
  }

  return <SSOLaunch providerId={launchProviderId} />
}
