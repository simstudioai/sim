import { stripeClient } from '@better-auth/stripe/client'
import { emailOTPClient, genericOAuthClient, organizationClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

const clientEnv = {
  NEXT_PUBLIC_VERCEL_URL: process.env.NEXT_PUBLIC_VERCEL_URL,
  NODE_ENV: process.env.NODE_ENV,
  VERCEL_ENV: process.env.VERCEL_ENV || '',
  BETTER_AUTH_URL: process.env.BETTER_AUTH_URL || 'http://localhost:3000',
}

export function getBaseURL() {
  let baseURL

  if (clientEnv.VERCEL_ENV === 'preview') {
    baseURL = `https://${clientEnv.NEXT_PUBLIC_VERCEL_URL}`
  } else if (clientEnv.VERCEL_ENV === 'development') {
    baseURL = `https://${clientEnv.NEXT_PUBLIC_VERCEL_URL}`
  } else if (clientEnv.VERCEL_ENV === 'production') {
    baseURL = clientEnv.BETTER_AUTH_URL
  } else if (clientEnv.NODE_ENV === 'development') {
    baseURL = clientEnv.BETTER_AUTH_URL
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
