import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { isValidHandoffState, parseLoopbackPort } from '@/app/desktop/auth/validation'
import { buildConnectLoopbackUrl, sanitizeOAuthErrorSlug } from '@/app/desktop/connect/validation'

export const metadata: Metadata = {
  title: 'Returning to Sim',
  robots: { index: false },
}

export const dynamic = 'force-dynamic'

interface ConnectCompletePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function InvalidRequest() {
  return (
    <main className='flex min-h-screen items-center justify-center px-6'>
      <div className='max-w-sm text-center'>
        <h1 className='font-semibold text-foreground text-lg'>Nothing to return to</h1>
        <p className='mt-2 text-muted-foreground text-sm'>
          This page finishes an account connection started from the Sim desktop app.
        </p>
      </div>
    </main>
  )
}

/**
 * Post-OAuth bounce for the desktop connect handoff. better-auth redirects
 * the browser here after the provider callback (as the flow's callbackURL, or
 * errorCallbackURL with an `error` code). The page forwards state — and any
 * error — straight to the desktop app's 127.0.0.1 loopback, which refocuses
 * the app; the loopback responds with the "return to Sim" page. No token is
 * minted here: the credential already landed server-side during the callback.
 */
export default async function ConnectCompletePage({ searchParams }: ConnectCompletePageProps) {
  const params = await searchParams
  const state = typeof params.state === 'string' ? params.state : ''
  const port = parseLoopbackPort(typeof params.port === 'string' ? params.port : '')
  if (!isValidHandoffState(state) || port === null) {
    return <InvalidRequest />
  }

  const error = sanitizeOAuthErrorSlug(params.error)
  redirect(buildConnectLoopbackUrl(state, port, error ?? undefined))
}
