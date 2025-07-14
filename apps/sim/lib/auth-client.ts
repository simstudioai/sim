import { stripeClient } from '@better-auth/stripe/client'
import { emailOTPClient, genericOAuthClient, organizationClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'
import { env } from '@/lib/env'
import { isDev, isProd } from '@/lib/environment'

export function getBaseURL() {
  let baseURL

  if (env.VERCEL_ENV === 'preview') {
    baseURL = `https://${env.NEXT_PUBLIC_VERCEL_URL}`
  } else if (env.VERCEL_ENV === 'development') {
    baseURL = `https://${env.NEXT_PUBLIC_VERCEL_URL}`
  } else if (env.VERCEL_ENV === 'production') {
    baseURL = env.BETTER_AUTH_URL || env.NEXT_PUBLIC_APP_URL
  } else if (env.NODE_ENV === 'development') {
    baseURL = env.NEXT_PUBLIC_APP_URL || env.BETTER_AUTH_URL || 'http://localhost:3000'
  }

  return baseURL
}

export const client = createAuthClient({
  baseURL: getBaseURL(),
  plugins: [
    emailOTPClient(),
    genericOAuthClient(),
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

export const { useSession, useActiveOrganization } = client

export const useSubscription = () => {
  // In development, provide mock implementations
  if (isDev) {
    return {
      list: async () => ({ data: [] }),
      upgrade: async () => ({
        error: { message: 'Subscriptions are disabled in development mode' },
      }),
      cancel: async () => ({ data: null }),
      restore: async () => ({ data: null }),
    }
  }

  // In production, use the real implementation
  return {
    list: client.subscription?.list,
    upgrade: client.subscription?.upgrade,
    cancel: client.subscription?.cancel,
    restore: client.subscription?.restore,
  }
}

export const { signIn, signUp, signOut } = client
