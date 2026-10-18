import { generateShortId } from '@sim/utils/id'
import { trackSignUpConversions } from '@/lib/analytics/sign-up'
import type { SocialSignInProvider } from '@/lib/auth/social-sign-in'

const SOCIAL_SIGN_UP_MARKER_STORAGE_KEY = 'socialSignUpConversionMarker'

interface SocialSignUpConversionOptions {
  marker: string | null
  provider: SocialSignInProvider
  userId: string
  measurement: boolean
  marketing: boolean
}

/** Creates Better Auth's new-user-only destination and remembers this browser initiated it. */
export function createSocialSignUpCallbackURL(
  provider: SocialSignInProvider,
  callbackURL: string
): string {
  const marker = generateShortId()
  try {
    sessionStorage.setItem(SOCIAL_SIGN_UP_MARKER_STORAGE_KEY, marker)
  } catch {}

  const params = new URLSearchParams({
    provider,
    callbackURL,
    conversion: marker,
  })
  return `/signup/complete?${params.toString()}`
}

function claimSocialSignUpMarker(marker: string | null): boolean {
  if (!marker) return false

  try {
    if (sessionStorage.getItem(SOCIAL_SIGN_UP_MARKER_STORAGE_KEY) !== marker) return false
    sessionStorage.removeItem(SOCIAL_SIGN_UP_MARKER_STORAGE_KEY)
    return true
  } catch {
    return false
  }
}

/**
 * Claims a new-user marker before reporting so reloads and remounts cannot duplicate the signup.
 */
export async function trackSocialSignUpConversions({
  marker,
  provider,
  userId,
  measurement,
  marketing,
}: SocialSignUpConversionOptions): Promise<boolean> {
  if (!claimSocialSignUpMarker(marker)) return false

  await trackSignUpConversions({ method: provider, userId, measurement, marketing })
  return true
}
