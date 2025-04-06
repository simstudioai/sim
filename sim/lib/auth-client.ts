import { emailOTPClient, genericOAuthClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

export function getBaseURL() {
  let baseURL

  if (process.env.VERCEL_ENV === 'preview') {
    baseURL = `https://${process.env.VERCEL_URL}`
  } else if (process.env.VERCEL_ENV === 'development') {
    baseURL = `https://${process.env.VERCEL_URL}`
  } else if (process.env.VERCEL_ENV === 'production') {
    baseURL = process.env.BETTER_AUTH_URL
  } else if (process.env.NODE_ENV === 'development') {
    baseURL = process.env.BETTER_AUTH_URL
  }

  console.log('baseURL:', baseURL)
  return baseURL
}

export const client = createAuthClient({
  baseURL: getBaseURL(),
  plugins: [genericOAuthClient(), emailOTPClient()],
})
export const { useSession } = client

export const { signIn, signUp, signOut } = client
