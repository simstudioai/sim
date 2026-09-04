'use client'

import { Chip, cn } from '@sim/emcn'
import { Check } from '@sim/emcn/icons'
import { getErrorMessage } from '@sim/utils/errors'
import { signOut } from '@/lib/auth/auth-client'
import {
  OAUTH_SCOPE_DESCRIPTIONS,
  SIM_CLI_CLIENT_ID,
  visibleOAuthScopes,
} from '@/lib/auth/oauth-provider'
import {
  AuthFormMessage,
  AuthHeader,
  AuthSubmitButton,
  AuthTextLink,
} from '@/app/(auth)/components'
import { AUTH_BUTTON_CLASS } from '@/app/(auth)/components/constants'
import { OAuthConsentLoading } from '@/app/(auth)/oauth/consent/loading'
import { useOAuthConsent, useOAuthPublicClient } from '@/hooks/queries/oauth-provider'

/** Why the page refuses to render a grant, when it does. */
export type OAuthConsentRefusal = 'missing' | 'tampered' | 'unsigned'

const REFUSAL_MESSAGES: Record<OAuthConsentRefusal, string> = {
  missing: 'The authorization request is missing its client identifier.',
  tampered: 'This authorization request was altered on its way here.',
  unsigned: 'This authorization request did not come from Sim.',
}

interface OAuthConsentViewProps {
  /** Set when the page already knows the request is not a real one. */
  refusal: OAuthConsentRefusal | null
  clientId: string | null
  scope: string | null
  /** Where the code will be sent, shown so a lookalike app is visible as one. */
  redirectUri: string | null
  /** The signed-in account the grant will belong to. */
  email: string
}

/**
 * The host the authorization code will be delivered to, or `null` when the
 * request names none this page can read.
 *
 * A registered `client_name` is whatever the client called itself, so for a
 * public client the destination is the one part of the request an impostor
 * cannot borrow. A loopback address is named plainly rather than shown as an
 * IP, because "this computer" is what it means to the person reading it.
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
 * The consent card: which app is asking, what it will be able to do, and as
 * whom. Every decision here is a real grant, so the copy names the app and the
 * account rather than a generic "an application" — the page is the only place
 * a relayed or phished authorization can be caught, which is also why the
 * first-party CLI never skips it.
 */
export function OAuthConsentView({
  refusal,
  clientId,
  scope,
  redirectUri,
  email,
}: OAuthConsentViewProps) {
  const client = useOAuthPublicClient(clientId ?? undefined)
  const consent = useOAuthConsent()

  /**
   * No grant card without a client the server itself named.
   *
   * A failed lookup used to fall through to the fallback name and leave Allow
   * enabled, so an unknown or deleted client still rendered a complete,
   * clickable authorization — with everything on it read from the URL rather
   * than from Sim. Naming the app is this page's whole job, so not being able
   * to name it is a refusal, not a degraded heading.
   */
  const reason: OAuthConsentRefusal | null = refusal ?? (clientId ? null : 'missing')
  if (reason || client.isError) {
    return (
      <div className='space-y-6'>
        <AuthHeader
          title='Invalid request'
          description='This page can only be opened by an app signing in with Sim.'
        />
        <AuthFormMessage type='error' align='center'>
          {reason
            ? REFUSAL_MESSAGES[reason]
            : getErrorMessage(client.error, 'Sim could not identify the app asking for access.')}
        </AuthFormMessage>
      </div>
    )
  }

  if (client.isPending) return <OAuthConsentLoading />

  const isCli = clientId === SIM_CLI_CLIENT_ID
  /**
   * The registered name the lookup returned, never the raw client id and never
   * a name asserted by the URL: the id is what an impostor controls, so a
   * client the server declines to name is one this card must not vouch for.
   */
  const appName = client.data?.name ?? 'this app'
  const scopes = visibleOAuthScopes((scope ?? '').split(' ').filter(Boolean))
  const destination = describeDestination(redirectUri)

  const decide = (accept: boolean) => {
    consent.mutate(accept, {
      onSuccess: (url) => {
        window.location.assign(url)
      },
    })
  }

  const switchAccount = async () => {
    await signOut()
    window.location.assign(`/oauth/sign-in${window.location.search}`)
  }

  return (
    <div className='space-y-6'>
      <AuthHeader
        title={`Authorize ${appName}`}
        description={
          isCli
            ? 'Only continue if you started this from the Sim CLI in your terminal.'
            : 'Only continue if you started this yourself.'
        }
      />
      <div className='space-y-4'>
        {scopes.length > 0 && (
          <ul className='space-y-2 rounded-[10px] border border-[var(--border)] px-4 py-3'>
            {scopes.map((item) => (
              <li key={item} className='flex items-start gap-2 text-[var(--text-body)] text-sm'>
                <Check className='mt-[3px] size-[14px] shrink-0 text-[var(--text-icon)]' />
                <span>{OAUTH_SCOPE_DESCRIPTIONS[item]}</span>
              </li>
            ))}
          </ul>
        )}
        <p className='text-center text-[var(--text-muted)] text-caption'>
          {destination ? `Sends you back to ${destination}. ` : ''}Continuing as {email}.{' '}
          <AuthTextLink onClick={switchAccount} disabled={consent.isPending}>
            Not you?
          </AuthTextLink>
        </p>
        <AuthSubmitButton
          type='button'
          loading={consent.isPending && consent.variables === true}
          disabled={consent.isPending}
          loadingLabel='Authorizing'
          onClick={() => decide(true)}
        >
          Allow
        </AuthSubmitButton>
        <Chip
          type='button'
          fullWidth
          disabled={consent.isPending}
          className={cn(AUTH_BUTTON_CLASS, 'border border-[var(--border)]')}
          onClick={() => decide(false)}
        >
          Deny
        </Chip>
        {consent.isError && (
          <AuthFormMessage type='error' align='center'>
            {getErrorMessage(consent.error, 'Something went wrong. Please try again.')}
          </AuthFormMessage>
        )}
      </div>
    </div>
  )
}
