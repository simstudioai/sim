import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { AuthorizeHandoff } from '@/app/desktop/auth/authorize-handoff'
import {
  buildDesktopAuthPath,
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
    <main className='flex min-h-screen items-center justify-center px-6'>
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
 * Once the browser session is authenticated, an explicit Continue click mints
 * a better-auth one-time token and sends it to the loopback (RFC 8252 §7.3) —
 * no OS scheme registration needed. The gesture gate matters: state and port
 * are attacker-choosable in a crafted link, so a bare GET must never mint a
 * token (whoever holds the loopback port receives it). The app redeems the
 * token same-origin against /api/auth/one-time-token/verify, which sets the
 * session cookie in its partition.
 */
export default async function DesktopAuthPage({ searchParams }: DesktopAuthPageProps) {
  const params = await searchParams
  const state = typeof params.state === 'string' ? params.state : ''
  const port = parseLoopbackPort(typeof params.port === 'string' ? params.port : '')
  if (!isValidHandoffState(state) || port === null) {
    return <InvalidRequest />
  }

  // Force a DB-backed session read (bypass the cookie cache). A cache-only
  // session can outlive its DB row after a sign-out/revoke; a fresh read
  // sends the user to re-login instead of rendering a confirm screen whose
  // token mint is doomed to fail.
  const hdrs = await headers()
  const session = await auth.api.getSession({ headers: hdrs, query: { disableCookieCache: true } })
  if (!session?.user) {
    redirect(`/login?callbackUrl=${encodeURIComponent(buildDesktopAuthPath(state, port))}`)
  }

  return <AuthorizeHandoff state={state} port={port} email={session.user.email} />
}
