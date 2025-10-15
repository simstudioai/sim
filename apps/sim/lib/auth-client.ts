import { useContext } from 'react'
import { ssoClient } from '@better-auth/sso/client'
import { stripeClient } from '@better-auth/stripe/client'
import {
  customSessionClient,
  emailOTPClient,
  genericOAuthClient,
  organizationClient,
} from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'
import type { auth } from '@/lib/auth'
import { env } from '@/lib/env'
import { isBillingEnabled } from '@/lib/environment'
import { SessionContext, type SessionHookResult } from '@/lib/session/session-context'
import { getBaseUrl } from '@/lib/urls/utils'

export const client = createAuthClient({
  baseURL: getBaseUrl(),
  plugins: [
    emailOTPClient(),
    genericOAuthClient(),
    customSessionClient<typeof auth>(),
    ...(isBillingEnabled
      ? [
          stripeClient({
            subscription: true, // Enable subscription management
          }),
        ]
      : []),
    organizationClient(),
    ...(env.NEXT_PUBLIC_SSO_ENABLED ? [ssoClient()] : []),
  ],
})

export function useSession(): SessionHookResult {
  const ctx = useContext(SessionContext)
  if (!ctx) {
    throw new Error(
      'SessionProvider is not mounted. Wrap your app with <SessionProvider> in app/layout.tsx.'
    )
  }
  return ctx
}

export const { useActiveOrganization } = client

export const useSubscription = () => {
  return {
    list: client.subscription?.list,
    upgrade: client.subscription?.upgrade,
    cancel: client.subscription?.cancel,
    restore: client.subscription?.restore,
  }
}

export const { signIn, signUp, signOut } = client
