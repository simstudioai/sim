import type { Metadata } from 'next'
import { DesktopTitleBarLane } from '@/app/_shell/desktop-title-bar'

export const metadata: Metadata = {
  title: 'Sign-in couldn’t be completed',
  robots: { index: false },
}

export const dynamic = 'force-dynamic'

interface OAuthErrorPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/**
 * Landing page for OAuth flows that end in an error before the flow state can
 * be parsed — most commonly the user clicking "Cancel"/"Deny" at the
 * provider's consent screen (`?error=access_denied`). Better Auth redirects
 * such errors to `onAPIError.errorURL` (this page) BEFORE it can honor a
 * per-flow `errorCallbackURL`, so the desktop handoff's loopback is never
 * pinged. Without this page those errors 404'd (a dead-end); here the user
 * gets a clear message and a way back. Re-initiating the sign-in/connect from
 * the app supersedes the idle handoff, so no explicit hand-back is needed.
 */
const FRIENDLY: Record<string, string> = {
  access_denied: 'You declined the request at the provider, so nothing was connected.',
  oAuth_code_missing: 'The provider didn’t return a valid response. Please try again.',
  /**
   * DISABLE_REGISTRATION rejecting a first-time social sign-in. Better Auth
   * reports this as `signup disabled`, which it slugs into the `error` param.
   * Without a message here the visitor is told to "try again", which can never
   * succeed.
   */
  signup_disabled:
    'Account creation is disabled on this instance. Ask your admin to create an account for you.',
  /**
   * Better Auth refuses to link an untrusted provider onto an existing account
   * (`accountLinking.trustedProviders`). Retrying reproduces it exactly, so the
   * generic "try again" strands the user — name the recovery path instead.
   */
  account_not_linked:
    'An account already exists for this email address. Sign in using the method you originally signed up with.',
  /** The provider returned no email claim, so there is nothing to sign in as. */
  email_not_found:
    'Your identity provider didn’t share an email address with us, so we couldn’t complete sign-in. Please contact your administrator.',
}

function messageForError(code: string | undefined): string {
  if (code && FRIENDLY[code]) return FRIENDLY[code]
  return 'The sign-in couldn’t be completed. Please try again.'
}

export default async function OAuthErrorPage({ searchParams }: OAuthErrorPageProps) {
  const params = await searchParams
  const code = typeof params.error === 'string' ? params.error : undefined

  return (
    <main className='desktop-title-bar-page flex items-center justify-center px-6'>
      <DesktopTitleBarLane />
      <div className='max-w-sm text-center'>
        <h1 className='text-foreground text-lg'>Couldn’t complete that</h1>
        <p className='mt-2 text-muted-foreground text-sm'>{messageForError(code)}</p>
        <p className='mt-4 text-muted-foreground text-sm'>
          You can close this tab and try again from Sim.
        </p>
      </div>
    </main>
  )
}
