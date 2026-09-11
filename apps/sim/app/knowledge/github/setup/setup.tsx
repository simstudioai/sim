'use client'

import { useState } from 'react'
import { Chip, ChipCombobox } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import type {
  GitHubSearchSetupScope,
  SelectGitHubSearchSetupBody,
} from '@/lib/api/contracts/knowledge/github-setup'
import { resolveGitHubSetupUrl } from '@/lib/knowledge/github-setup-navigation'
import { AuthHeader } from '@/app/(auth)/components'
import { CredentialGroupCompletionHandoff } from '@/app/credential-groups/complete/completion-handoff'
import {
  isGitHubSetupTerminalError,
  useGitHubSearchSetup,
  useSelectGitHubSearchSetup,
} from '@/hooks/queries/github-search-setup'

interface GitHubSetupProps {
  scope: GitHubSearchSetupScope
}

export function GitHubSetup({ scope }: GitHubSetupProps) {
  const query = useGitHubSearchSetup(scope)
  const { mutateAsync: select, isPending } = useSelectGitHubSearchSetup()
  const [error, setError] = useState<string | null>(null)
  const result = query.data

  const choose = async (action: SelectGitHubSearchSetupBody['action']) => {
    setError(null)
    try {
      const response = await select({ ...scope, action })
      window.location.replace(resolveGitHubSetupUrl(response.url, window.location.origin))
    } catch (failure) {
      setError(getErrorMessage(failure, 'Could not connect GitHub. Try again.'))
    }
  }

  const failure =
    (isGitHubSetupTerminalError(query.error) ? query.error?.message : null) ??
    (result?.status === 'failed'
      ? result.error
      : result?.status === 'expired'
        ? 'This connection attempt expired. Close this window and connect GitHub again from Sim.'
        : null)

  if (failure) return <AuthHeader title='GitHub not connected' description={failure} />
  if (result?.status === 'completed') {
    return (
      <>
        <CredentialGroupCompletionHandoff completionId={scope.setupId} />
        <AuthHeader title='GitHub connected' description='You can close this window.' />
      </>
    )
  }
  if (result?.status !== 'choosing') {
    return <AuthHeader title='Connecting GitHub…' />
  }

  return (
    <>
      <AuthHeader title='Choose GitHub account' />
      <div className='mt-6 flex flex-col gap-3'>
        <ChipCombobox
          aria-label='GitHub account'
          options={result.installations.map((installation) => ({
            value: installation.installationId,
            label: installation.accountLogin,
          }))}
          placeholder={isPending ? 'Connecting GitHub…' : 'Select an account'}
          disabled={isPending}
          onChange={(installationId) => void choose({ kind: 'select', installationId })}
        />
        <Chip disabled={isPending} onClick={() => void choose({ kind: 'install' })}>
          Connect another organization
        </Chip>
        {error && (
          <p role='alert' className='text-[var(--text-error)] text-sm'>
            {error}
          </p>
        )}
      </div>
    </>
  )
}
