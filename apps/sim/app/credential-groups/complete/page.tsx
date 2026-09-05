import type { Metadata } from 'next'
import { AuthHeader, AuthShell } from '@/app/(auth)/components'

export const metadata: Metadata = {
  title: 'Accounts connected',
  robots: { index: false, follow: false },
}

const OAUTH_FAILURE_MESSAGES = {
  denied: 'Authorization was canceled. Return to the chat to try again.',
  account_mismatch: 'Choose the account matching your Sim email address.',
  permissions_required: 'All requested permissions are required to connect this account.',
  configuration_changed: 'The connection settings changed. Return to the chat to try again.',
  rate_limited: 'Too many authorization attempts. Wait a few minutes and try again.',
  unavailable: 'This connection is unavailable. Return to the chat to try again.',
  failed: 'Account authorization did not complete. Return to the chat to try again.',
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
    </AuthShell>
  )
}
