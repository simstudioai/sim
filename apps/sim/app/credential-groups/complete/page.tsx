import { ChipLink } from '@sim/emcn'
import { isValidUuid } from '@sim/utils/id'
import type { Metadata } from 'next'
import {
  CREDENTIAL_GROUP_OAUTH_FAILURE_MESSAGES,
  isCredentialGroupOAuthFailure,
} from '@/lib/credential-groups/oauth-completion'
import { APP_ENTRY_PATH } from '@/lib/navigation/paths'
import { AuthHeader, AuthShell } from '@/app/(auth)/components'
import { CredentialGroupCompletionHandoff } from '@/app/credential-groups/complete/completion-handoff'

export const metadata: Metadata = {
  title: 'Accounts connected',
  robots: { index: false, follow: false },
}

export default async function CredentialGroupCompletePage({
  searchParams,
}: {
  searchParams: Promise<{ oauth?: string | string[]; completionId?: string | string[] }>
}) {
  const { oauth, completionId } = await searchParams
  const failure =
    oauth === undefined ? undefined : isCredentialGroupOAuthFailure(oauth) ? oauth : 'failed'
  const error = failure ? CREDENTIAL_GROUP_OAUTH_FAILURE_MESSAGES[failure] : undefined
  return (
    <AuthShell>
      {typeof completionId === 'string' && isValidUuid(completionId) && (
        <CredentialGroupCompletionHandoff completionId={completionId} failure={failure} />
      )}
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
