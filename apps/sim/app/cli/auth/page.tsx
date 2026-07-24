import { Suspense } from 'react'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import type { SearchParams } from 'nuqs/server'
import { getSession } from '@/lib/auth'
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
 * Signed-out visitors bounce through login carrying a *re-serialized*
 * `callbackUrl` — only the params the handoff understands survive, so the round
 * trip cannot be used to smuggle anything else back into this page. The request
 * is validated before that bounce: a bogus callback is rejected here rather
 * than after making the user sign in for nothing.
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
      callback: resolution.request.callback,
      state: resolution.request.state,
      challenge: resolution.request.challenge,
      pairing: resolution.request.pairing,
    })
    redirect(`/login?callbackUrl=${encodeURIComponent(`/cli/auth?${query}`)}`)
  }

  return (
    <AuthShell>
      <Suspense fallback={<CliAuthLoading />}>
        <CliAuthView />
      </Suspense>
    </AuthShell>
  )
}
