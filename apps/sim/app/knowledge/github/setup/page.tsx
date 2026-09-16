import type { Metadata } from 'next'
import { gitHubSearchSetupScopeSchema } from '@/lib/api/contracts/knowledge/github-setup'
import { AuthHeader, AuthShell } from '@/app/(auth)/components'
import { GitHubSetup } from '@/app/knowledge/github/setup/setup'

export const metadata: Metadata = {
  title: 'Connect GitHub',
  robots: { index: false, follow: false },
}

export default async function GitHubSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ organizationId?: string | string[]; setupId?: string | string[] }>
}) {
  const { organizationId, setupId } = await searchParams
  const scope = gitHubSearchSetupScopeSchema.safeParse({ organizationId, setupId })
  return (
    <AuthShell>
      {scope.success ? (
        <GitHubSetup scope={scope.data} />
      ) : (
        <AuthHeader
          title='Connection unavailable'
          description='Close this window and connect GitHub again from Sim.'
        />
      )}
    </AuthShell>
  )
}
