import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import {
  buildDesktopAuthPath,
  buildLoopbackUrl,
  isValidHandoffState,
  parseLoopbackPort,
} from '@/app/desktop/auth/validation'

export const metadata: Metadata = {
  title: 'Sign in to Sim Desktop',
  robots: { index: false },
}

export const dynamic = 'force-dynamic'

interface DesktopAuthPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function InvalidRequest() {
  return (
    <main className='desktop-title-bar-page flex items-center justify-center px-6'>
      <div className='max-w-sm text-center'>
        <h1 className='font-semibold text-foreground text-lg'>Sign-in link incomplete</h1>
        <p className='mt-2 text-muted-foreground text-sm'>
          Open the Sim desktop app and choose Sign In to start again.
        </p>
      </div>
    </main>
  )
}

/**
 * Desktop login landing. The desktop app opens this page in the system browser
 * with a one-time state and the port of a local 127.0.0.1 loopback listener.
 * Once the browser session is authenticated it mints a better-auth one-time
 * token and redirects straight to the loopback (RFC 8252 §7.3) — a single,
 * deterministic hand-back with no OS scheme registration and no client-side
 * step. The app redeems the token same-origin against
 * /api/auth/one-time-token/verify, which sets the session cookie in its
 * partition.
 */
export default async function DesktopAuthPage({ searchParams }: DesktopAuthPageProps) {
  const params = await searchParams
  const state = typeof params.state === 'string' ? params.state : ''
  const port = parseLoopbackPort(typeof params.port === 'string' ? params.port : '')
  if (!isValidHandoffState(state) || port === null) {
    return <InvalidRequest />
  }

  // Force a DB-backed session read (bypass the cookie cache). A cache-only
  // session can outlive its DB row after a sign-out/revoke, and minting a
  // one-time token against a dead session makes /one-time-token/verify fail
  // with "Session not found" (400) on redeem. A fresh read sends the user to
  // re-login instead of minting a doomed token.
  const hdrs = await headers()
  const session = await auth.api.getSession({ headers: hdrs, query: { disableCookieCache: true } })
  if (!session?.user) {
    redirect(`/login?callbackUrl=${encodeURIComponent(buildDesktopAuthPath(state, port))}`)
  }

  let token: string | null = null
  try {
    const response = await auth.api.generateOneTimeToken({ headers: hdrs })
    token = response?.token ?? null
  } catch {
    token = null
  }
  if (!token) {
    redirect(`/login?callbackUrl=${encodeURIComponent(buildDesktopAuthPath(state, port))}`)
  }

  redirect(buildLoopbackUrl(token, state, port))
}
