import { Suspense } from 'react'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import type { SearchParams } from 'nuqs/server'
import { getSession } from '@/lib/auth'
import { isRegistrationDisabled } from '@/lib/core/config/env-flags'
import { buildAuthCrossLink } from '@/app/(auth)/auth-redirect'
import { AuthShell } from '@/app/(auth)/components'
import { resolveCliAuthRequest } from '@/app/cli/auth/cli-auth-request'
import { CliAuthView } from '@/app/cli/auth/cli-auth-view'
import { CliAuthLoading } from '@/app/cli/auth/loading'
import { cliAuthSearchParamsCache } from '@/app/cli/auth/search-params'

export const metadata: Metadata = {
  title: 'Connect your terminal',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

/**
 * Browser half of the CLI key handoff.
 *
 * Signed-out visitors bounce through signup carrying a *re-serialized*
 * `callbackUrl` — only the params the handoff understands survive, so the round
 * trip cannot be used to smuggle anything else back into this page. The request
 * is validated before that bounce: a bogus callback is rejected here rather
 * than after making the user sign in for nothing.
 *
 * Signup rather than login because this page is reached from a terminal: the
 * setup wizard sends people here while standing up a self-host, and someone
 * configuring Sim for the first time has no account yet. Both auth pages
 * cross-link carrying the same `callbackUrl`, so a returning user is one click
 * from login with their destination intact.
 *
 * That reasoning inverts under DISABLE_REGISTRATION: nobody can create an
 * account, so the pairing visitor is necessarily an existing user and signup is
 * guaranteed to be the wrong hop. Go straight to login there.
 */
export default async function CliAuthPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const [session, params] = await Promise.all([
    getSession(),
    cliAuthSearchParamsCache.parse(searchParams),
  ])

  const resolution = resolveCliAuthRequest(params)

  if (resolution.valid && !session?.user) {
    const query = new URLSearchParams({
      request: resolution.request.request,
      challenge: resolution.request.challenge,
      pairing: resolution.request.pairing,
    })
    redirect(
      buildAuthCrossLink(isRegistrationDisabled ? '/login' : '/signup', {
        callbackUrl: `/cli/auth?${query}`,
        isInviteFlow: false,
      })
    )
  }

  return (
    <AuthShell>
      <Suspense fallback={<CliAuthLoading />}>
        <CliAuthView />
      </Suspense>
    </AuthShell>
  )
}
