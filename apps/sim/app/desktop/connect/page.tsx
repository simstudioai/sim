import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { isValidHandoffState, parseLoopbackPort } from '@/app/desktop/auth/validation'
import { ConnectLauncher } from '@/app/desktop/connect/connect-launcher'
import {
  buildConnectCompletePath,
  buildDesktopConnectPath,
  isValidOAuthProviderId,
} from '@/app/desktop/connect/validation'

export const metadata: Metadata = {
  title: 'Connect an account to Sim',
  robots: { index: false },
}

export const dynamic = 'force-dynamic'

interface DesktopConnectPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function InvalidRequest() {
  return (
    <main className='flex min-h-screen items-center justify-center px-6'>
      <div className='max-w-sm text-center'>
        <h1 className='font-semibold text-foreground text-lg'>Connection link incomplete</h1>
        <p className='mt-2 text-muted-foreground text-sm'>
          Return to the Sim desktop app and start the connection again.
        </p>
      </div>
    </main>
  )
}

/**
 * Desktop OAuth-connect landing. The desktop app opens this page in the
 * system browser with the provider to connect, a one-time state, and the port
 * of its 127.0.0.1 loopback listener. The whole OAuth flow runs here — in the
 * browser — because better-auth binds the flow's state to the initiating user
 * agent's cookies. After the provider callback, better-auth redirects to
 * /desktop/connect/complete, which bounces state (and any error) to the
 * loopback so the app can refocus itself and show the connected toast.
 */
export default async function DesktopConnectPage({ searchParams }: DesktopConnectPageProps) {
  const params = await searchParams
  const providerId = typeof params.provider === 'string' ? params.provider : ''
  const state = typeof params.state === 'string' ? params.state : ''
  const port = parseLoopbackPort(typeof params.port === 'string' ? params.port : '')
  if (!isValidOAuthProviderId(providerId) || !isValidHandoffState(state) || port === null) {
    return <InvalidRequest />
  }

  // Force a DB-backed session read (bypass the cookie cache) so a revoked
  // browser session goes to login instead of starting a doomed link flow.
  const hdrs = await headers()
  const session = await auth.api.getSession({ headers: hdrs, query: { disableCookieCache: true } })
  if (!session?.user) {
    redirect(
      `/login?callbackUrl=${encodeURIComponent(buildDesktopConnectPath(providerId, state, port))}`
    )
  }

  return (
    <ConnectLauncher providerId={providerId} completePath={buildConnectCompletePath(state, port)} />
  )
}
