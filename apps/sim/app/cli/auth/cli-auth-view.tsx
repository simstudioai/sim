'use client'

import { getErrorMessage } from '@sim/utils/errors'
import { useRouter } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import { AuthFormMessage, AuthHeader, AuthSubmitButton } from '@/app/(auth)/components'
import { resolveCliAuthRequest } from '@/app/cli/auth/cli-auth-request'
import { cliAuthParsers } from '@/app/cli/auth/search-params'
import { useApproveCliAuth } from '@/hooks/queries/cli-auth'

/**
 * The signed-in half of the CLI key handoff: a consent card that records the
 * user's approval so the terminal's poll can complete. No key passes through
 * the browser.
 *
 * The pairing code leads the card because it is the only signal that separates
 * the visitor's own terminal from a link someone sent them — an attacker who
 * opened the page supplies the request id and challenge, but not the code the
 * victim's terminal printed.
 */
export function CliAuthView() {
  const router = useRouter()
  const [params] = useQueryStates(cliAuthParsers)
  const approve = useApproveCliAuth()

  const resolution = resolveCliAuthRequest(params)

  if (!resolution.valid) {
    return (
      <div className='space-y-6'>
        <AuthHeader
          title='Invalid request'
          description='This page can only be opened by the Sim CLI.'
        />
        <AuthFormMessage type='error' align='center'>
          {resolution.reason}
        </AuthFormMessage>
      </div>
    )
  }

  const { request } = resolution

  return (
    <div className='space-y-6'>
      <AuthHeader
        title='Connect your terminal'
        description='Approve only if the code below matches the one in your terminal.'
      />
      <div className='space-y-4'>
        <div className='flex items-center justify-center rounded-[10px] border border-[var(--border-1)] py-5'>
          {/* `pl` offsets the trailing letter-space `tracking` adds after the last glyph, which would otherwise pull the code left of optical center. */}
          <code className='pl-[0.2em] font-mono text-[28px] text-[var(--text-primary)] leading-none tracking-[0.2em]'>
            {request.pairing}
          </code>
        </div>
        <AuthSubmitButton
          type='button'
          loading={approve.isPending || approve.isSuccess}
          loadingLabel='Connecting'
          onClick={() =>
            approve.mutate(
              { request: request.request, challenge: request.challenge },
              { onSuccess: () => router.push('/cli/auth/done') }
            )
          }
        >
          Connect
        </AuthSubmitButton>
        {approve.isError && (
          <AuthFormMessage type='error' align='center'>
            {getErrorMessage(approve.error, 'Failed to connect. Please try again.')}
          </AuthFormMessage>
        )}
      </div>
    </div>
  )
}
