'use client'

import { AuthAccountMenu, AuthButton as Chip } from '@sim/auth-ui'
import { Check } from '@sim/emcn/icons'
import { getErrorMessage } from '@sim/utils/errors'
import {
  OAUTH_SCOPE_DESCRIPTIONS,
  SIM_CLI_CLIENT_ID,
  visibleOAuthScopes,
} from '@/lib/auth/oauth-provider'
import { AuthFormMessage, AuthHeader, AuthSubmitButton } from '@/app/(auth)/components'
import { AUTH_BUTTON_CLASS } from '@/app/(auth)/components/constants'
import { OAuthConsentLoading } from '@/app/(auth)/oauth/consent/loading'
import {
  useOAuthConsent,
  useOAuthPublicClient,
  useOAuthSwitchAccount,
} from '@/hooks/queries/oauth-provider'

export type OAuthConsentRefusal = 'expired' | 'missing' | 'tampered' | 'unsigned'

const REFUSAL_MESSAGES: Record<OAuthConsentRefusal, string> = {
  expired: 'This authorization request has expired. Start sign-in again from the app.',
  missing: 'The authorization request is missing its client identifier.',
  tampered: 'This authorization request was altered on its way here.',
  unsigned: 'This authorization request did not come from Sim.',
}

interface OAuthConsentViewProps {
  /** Set when the page already knows the request is not a real one. */
  refusal: OAuthConsentRefusal | null
  clientId: string | null
  /** Isolates cached client metadata to every parameter in this signed request. */
  authorizationRequestKey: string | null
  scope: string | null
  /** Where the code will be sent, shown so a lookalike app is visible as one. */
  redirectUri: string | null
  /** The signed-in account the grant will belong to. */
  email: string
}

/**
 * Shows the redirect host beside the app name to help identify impersonation;
 * names loopback callbacks as this computer.
 */
function describeDestination(redirectUri: string | null): string | null {
  if (!redirectUri) return null
  try {
    const { hostname } = new URL(redirectUri)
    return hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1'
      ? 'this computer'
      : hostname
  } catch {
    return null
  }
}

/**
 * Always names the app and account, including for the CLI, so users can
 * recognize relayed authorization attempts.
 */
export function OAuthConsentView({
  refusal,
  clientId,
  authorizationRequestKey,
  scope,
  redirectUri,
  email,
}: OAuthConsentViewProps) {
  const client = useOAuthPublicClient(clientId ?? undefined, authorizationRequestKey ?? undefined)
  const consent = useOAuthConsent()
  const switchAccount = useOAuthSwitchAccount()

  /** Refuses clients Sim cannot name because URL metadata alone is untrusted. */
  const reason: OAuthConsentRefusal | null = refusal ?? (clientId ? null : 'missing')
  if (reason || client.isError) {
    return (
      <AuthHeader
        title='Unable to connect'
        description={
          reason
            ? REFUSAL_MESSAGES[reason]
            : getErrorMessage(
                client.error,
                'Sim could not identify the app. Start again from the app.'
              )
        }
      />
    )
  }

  if (client.isPending) return <OAuthConsentLoading />

  const isCli = clientId === SIM_CLI_CLIENT_ID
  /** Uses only the server-registered name; the client ID comes from the URL. */
  const appName = client.data?.name?.trim()
  if (!appName) {
    return (
      <AuthHeader
        title='Unable to connect'
        description='Sim could not identify the app. Start again from the app asking for access.'
      />
    )
  }
  const scopes = visibleOAuthScopes((scope ?? '').split(' ').filter(Boolean))
  const destination = describeDestination(redirectUri)
  const isPending =
    consent.isPending || consent.isSuccess || switchAccount.isPending || switchAccount.isSuccess

  const decide = (accept: boolean) => {
    if (isPending) return
    switchAccount.reset()
    consent.mutate(accept, {
      onSuccess: (url) => {
        window.location.assign(url)
      },
    })
  }

  const changeAccount = () => {
    if (isPending) return
    consent.reset()
    switchAccount.mutate(undefined, {
      onSuccess: () => {
        const params = new URLSearchParams(window.location.search)
        params.set('prompt', 'login consent')
        window.location.assign(`/oauth/sign-in?${params.toString()}`)
      },
    })
  }

  return (
    <div className='au:space-y-[var(--auth-group-gap)]'>
      <AuthHeader
        title={`Authorize ${appName}`}
        description={isCli ? undefined : 'Only continue if you started this yourself.'}
      />
      <AuthAccountMenu
        email={email}
        disabled={isPending}
        pending={switchAccount.isPending}
        onSwitch={changeAccount}
      />
      <div className='au:space-y-[var(--auth-group-gap)]'>
        {scopes.length > 0 && (
          <ul className='au:space-y-2 au:px-2'>
            {scopes.map((item) => (
              <li
                key={item}
                className='au:flex au:items-start au:gap-2 au:text-[var(--auth-primary)] au:text-body'
              >
                <Check
                  aria-hidden='true'
                  className='au:mt-[3px] au:size-4 au:shrink-0 au:text-[var(--auth-secondary)]'
                />
                <span>{OAUTH_SCOPE_DESCRIPTIONS[item]}</span>
              </li>
            ))}
          </ul>
        )}
        {!isCli && destination && (
          <p className='au:break-words au:text-[var(--auth-secondary)] au:text-caption'>
            Returns to {destination}.
          </p>
        )}
        <div className='au:space-y-2'>
          <AuthSubmitButton
            type='button'
            loading={consent.isPending && consent.variables === true}
            disabled={isPending}
            loadingLabel='Authorizing'
            onClick={() => decide(true)}
          >
            Allow
          </AuthSubmitButton>
          <Chip
            type='button'
            variant='border'
            fullWidth
            disabled={isPending}
            className={AUTH_BUTTON_CLASS}
            onClick={() => decide(false)}
          >
            {consent.isPending && consent.variables === false ? 'Declining…' : 'Deny'}
          </Chip>
        </div>
        {(consent.isError || switchAccount.isError) && (
          <div role='alert'>
            <AuthFormMessage type='error' align='center'>
              {getErrorMessage(
                consent.error ?? switchAccount.error,
                'Something went wrong. Please try again.'
              )}
            </AuthFormMessage>
          </div>
        )}
      </div>
    </div>
  )
}
