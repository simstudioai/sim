import { stripeClient } from '@better-auth/stripe/client'
import { emailOTPClient, genericOAuthClient, organizationClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'
import { env } from './env'

const clientEnv = {
  NEXT_PUBLIC_VERCEL_URL: env.NEXT_PUBLIC_VERCEL_URL,
  NEXT_PUBLIC_APP_URL: env.NEXT_PUBLIC_APP_URL,
  NODE_ENV: env.NODE_ENV,
  VERCEL_ENV: env.VERCEL_ENV || '',
  BETTER_AUTH_URL: env.BETTER_AUTH_URL,
}

export function getBaseURL() {
  let baseURL

  if (clientEnv.VERCEL_ENV === 'preview') {
    baseURL = `https://${clientEnv.NEXT_PUBLIC_VERCEL_URL}`
  } else if (clientEnv.VERCEL_ENV === 'development') {
    baseURL = `https://${clientEnv.NEXT_PUBLIC_VERCEL_URL}`
  } else if (clientEnv.VERCEL_ENV === 'production') {
    baseURL = clientEnv.BETTER_AUTH_URL || clientEnv.NEXT_PUBLIC_APP_URL
  } else if (clientEnv.NODE_ENV === 'development') {
    baseURL = clientEnv.NEXT_PUBLIC_APP_URL || clientEnv.BETTER_AUTH_URL || 'http://localhost:3000'
  }

  return baseURL
}

export const client = createAuthClient({
  baseURL: getBaseURL(),
  plugins: [
    emailOTPClient(),
    genericOAuthClient(),
    // Only include Stripe client in production
    ...(clientEnv.NODE_ENV === 'production'
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
  if (clientEnv.NODE_ENV === 'development') {
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
