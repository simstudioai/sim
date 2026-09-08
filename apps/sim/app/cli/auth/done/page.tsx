import type { Metadata } from 'next'
import type { SearchParams } from 'nuqs/server'
import { AuthShell } from '@/app/(auth)/components'
import { CliAuthDoneView } from '@/app/cli/auth/done/cli-auth-done-view'
import { cliAuthDoneSearchParamsCache } from '@/app/cli/auth/done/search-params'

export const metadata: Metadata = {
  title: 'Terminal sign-in',
  robots: { index: false, follow: false },
}

/**
 * Sessionless completion for OAuth and pairing flows. The status is informational
 * and never exchanges credentials or changes authorization.
 */
export default async function CliAuthDonePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const { status } = await cliAuthDoneSearchParamsCache.parse(searchParams)

  return (
    <AuthShell>
      <CliAuthDoneView status={status} />
    </AuthShell>
  )
}
