import { ChipLink } from '@sim/emcn'
import type { Metadata } from 'next'
import { APP_ENTRY_PATH } from '@/lib/navigation/paths'
import { AuthHeader, AuthShell } from '@/app/(auth)/components'

export const metadata: Metadata = {
  title: 'Accounts connected',
  robots: { index: false, follow: false },
}

const OAUTH_FAILURE_MESSAGES = {
  expired: 'This connection attempt expired. Open Sim and start connecting your account again.',
  denied: 'Authorization was canceled. Open Sim to try again.',
  account_mismatch: 'Choose the account matching your Sim email address.',
  permissions_required: 'All requested permissions are required to connect this account.',
  configuration_changed: 'The connection settings changed. Open Sim to try again.',
  rate_limited: 'Too many authorization attempts. Wait a few minutes and try again.',
  unavailable: 'This connection is unavailable. Open Sim to try again.',
  failed: 'Account authorization did not complete. Open Sim to try again.',
} as const

export default async function CredentialGroupCompletePage({
  searchParams,
}: {
  searchParams: Promise<{ oauth?: string | string[] }>
}) {
  const { oauth } = await searchParams
  const error =
    typeof oauth === 'string' && Object.hasOwn(OAUTH_FAILURE_MESSAGES, oauth)
      ? OAUTH_FAILURE_MESSAGES[oauth as keyof typeof OAUTH_FAILURE_MESSAGES]
      : undefined
  return (
    <AuthShell>
      <AuthHeader
        title={error ? 'Account not connected' : 'Accounts connected'}
        description={error ?? 'Your accounts are ready to use — you can close this tab.'}
      />
      {error && (
        <div className='mt-6 flex justify-center'>
          <ChipLink href={APP_ENTRY_PATH}>Open Sim</ChipLink>
        </div>
      )}
    </AuthShell>
  )
}
