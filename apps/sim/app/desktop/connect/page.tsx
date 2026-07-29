import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { isValidHandoffState, parseLoopbackPort } from '@/app/desktop/auth/validation'
import { DesktopHandoffShell } from '@/app/desktop/components/desktop-handoff-shell'
import { ConnectLauncher } from '@/app/desktop/connect/connect-launcher'
import { SwitchAccount } from '@/app/desktop/connect/switch-account'
import {
  buildConnectCompletePath,
  buildDesktopConnectPath,
  isValidOAuthProviderId,
  isValidOpaqueId,
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
    <DesktopHandoffShell
      title='Connection link incomplete'
      description='Return to the Sim desktop app and start the connection again.'
    />
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
  const workspaceId = isValidOpaqueId(params.workspaceId) ? params.workspaceId : undefined
  const credentialId = isValidOpaqueId(params.credentialId) ? params.credentialId : undefined
  const expectedUserId = isValidOpaqueId(params.user) ? params.user : undefined
  if (!isValidOAuthProviderId(providerId) || !isValidHandoffState(state) || port === null) {
    return <InvalidRequest />
  }

  // Force a DB-backed session read (bypass the cookie cache) so a revoked
  // browser session goes to login instead of starting a doomed link flow.
  const hdrs = await headers()
  const session = await auth.api.getSession({ headers: hdrs, query: { disableCookieCache: true } })
  if (!session?.user) {
    redirect(
      `/login?callbackUrl=${encodeURIComponent(
        buildDesktopConnectPath(providerId, state, port, {
          workspaceId,
          credentialId,
          user: expectedUserId,
        })
      )}`
    )
  }

  // The OAuth flow must run in this browser (better-auth binds its state to the
  // initiating user agent), so the credential lands on whichever account the
  // BROWSER is signed into. The desktop app has its own session, so that can be
  // a different account than the one that asked for the connection — refuse
  // rather than silently attach the provider to the wrong account.
  if (expectedUserId && session.user.id !== expectedUserId) {
    return (
      <DesktopHandoffShell
        title='Wrong account in this browser'
        description={`This browser is signed in as ${session.user.email}, but the connection was started from a Sim desktop app signed in as a different account. Switch accounts here to continue.`}
      >
        <SwitchAccount
          returnTo={buildDesktopConnectPath(providerId, state, port, {
            workspaceId,
            credentialId,
            user: expectedUserId,
          })}
        />
      </DesktopHandoffShell>
    )
  }

  // Workspace-scoped connects (the copilot's credential chips) go through the
  // authorize route, which owns the workspace access checks and the connect
  // draft — including reconnect rebinding when a credentialId rides along.
  // Modal-initiated connects have no workspaceId here (the desktop app already
  // created the draft) and use the plain link flow below.
  if (workspaceId) {
    const authorize = new URL('/api/auth/oauth2/authorize', getBaseUrl())
    authorize.searchParams.set('providerId', providerId)
    authorize.searchParams.set('workspaceId', workspaceId)
    authorize.searchParams.set(
      'callbackURL',
      `${getBaseUrl()}${buildConnectCompletePath(state, port)}`
    )
    if (credentialId) {
      authorize.searchParams.set('credentialId', credentialId)
    }
    redirect(authorize.toString())
  }

  return (
    <ConnectLauncher providerId={providerId} completePath={buildConnectCompletePath(state, port)} />
  )
}
