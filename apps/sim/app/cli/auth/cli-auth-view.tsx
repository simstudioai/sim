'use client'

import { getErrorMessage } from '@sim/utils/errors'
import { useQueryStates } from 'nuqs'
import { AuthFormMessage, AuthHeader, AuthSubmitButton } from '@/app/(auth)/components'
import { buildCliHandoffUrl, resolveCliAuthRequest } from '@/app/cli/auth/cli-auth-request'
import { cliAuthParsers } from '@/app/cli/auth/search-params'
import { useApproveCliAuth } from '@/hooks/queries/cli-auth'

/**
 * The signed-in half of the CLI key handoff: a consent card that mints a
 * single-use authorization code and hands it to the waiting terminal.
 *
 * The pairing code leads the card because PKCE cannot tell the visitor's own
 * terminal from a link someone sent them — an attacker who opened the page
 * supplies both the callback and the challenge.
 */
export function CliAuthView() {
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
          loading={approve.isPending}
          loadingLabel='Connecting'
          onClick={() =>
            approve.mutate(
              { challenge: request.challenge },
              {
                onSuccess: (data) => {
                  window.location.href = buildCliHandoffUrl(request, data.code)
                },
              }
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
