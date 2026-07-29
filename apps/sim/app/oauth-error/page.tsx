import type { Metadata } from 'next'

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
}

function messageForError(code: string | undefined): string {
  if (code && FRIENDLY[code]) return FRIENDLY[code]
  return 'The sign-in couldn’t be completed. Please try again.'
}

export default async function OAuthErrorPage({ searchParams }: OAuthErrorPageProps) {
  const params = await searchParams
  const code = typeof params.error === 'string' ? params.error : undefined

  return (
    <main className='flex min-h-screen items-center justify-center px-6'>
      <div className='max-w-sm text-center'>
        <h1 className='font-semibold text-foreground text-lg'>Couldn’t complete that</h1>
        <p className='mt-2 text-muted-foreground text-sm'>{messageForError(code)}</p>
        <p className='mt-4 text-muted-foreground text-sm'>
          You can close this tab and try again from Sim.
        </p>
      </div>
    </main>
  )
}
