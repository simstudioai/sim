import { useContext } from 'react'
import { stripeClient } from '@better-auth/stripe/client'
import {
  customSessionClient,
  emailOTPClient,
  genericOAuthClient,
  organizationClient,
} from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'
import type { auth } from '@/lib/auth'
import { env, getEnv } from '@/lib/env'
import { isProd } from '@/lib/environment'
import { SessionContext, type SessionHookResult } from '@/lib/session/session-context'

export function getBaseURL() {
  let baseURL

  if (env.VERCEL_ENV === 'preview') {
    baseURL = `https://${getEnv('NEXT_PUBLIC_VERCEL_URL')}`
  } else if (env.VERCEL_ENV === 'development') {
    baseURL = `https://${getEnv('NEXT_PUBLIC_VERCEL_URL')}`
  } else if (env.VERCEL_ENV === 'production') {
    baseURL = env.BETTER_AUTH_URL || getEnv('NEXT_PUBLIC_APP_URL')
  } else if (env.NODE_ENV === 'development') {
    baseURL = getEnv('NEXT_PUBLIC_APP_URL') || env.BETTER_AUTH_URL || 'http://localhost:3000'
  }

  return baseURL
}

export const client = createAuthClient({
  baseURL: getBaseURL(),
  plugins: [
    emailOTPClient(),
    genericOAuthClient(),
    customSessionClient<typeof auth>(),
    // Only include Stripe client in production
    ...(isProd
      ? [
          stripeClient({
            subscription: true, // Enable subscription management
          }),
        ]
      : []),
    organizationClient(),
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
