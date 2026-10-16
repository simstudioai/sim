import { env } from '@/lib/core/config/env'

/** Google integrations whose hosted scopes are still undergoing verification. */
export function isGoogleVerificationProvider(providerId: string): boolean {
  return providerId === 'google-ads' || providerId === 'google-meet' || providerId === 'google-chat'
}

/** A partial isolated-client configuration must never fall back to the shared application. */
export function getGoogleOAuthClientValues(providerId: string) {
  if (
    isGoogleVerificationProvider(providerId) &&
    (env.GOOGLE_VERIFICATION_CLIENT_ID !== undefined ||
      env.GOOGLE_VERIFICATION_CLIENT_SECRET !== undefined)
  ) {
    return {
      GOOGLE_CLIENT_ID: env.GOOGLE_VERIFICATION_CLIENT_ID,
      GOOGLE_CLIENT_SECRET: env.GOOGLE_VERIFICATION_CLIENT_SECRET,
    }
  }
  return env
}
