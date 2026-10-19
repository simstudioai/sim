import { generateShortId } from '@sim/utils/id'
import { trackSignUpConversions } from '@/lib/analytics/sign-up'
import type { SocialSignInProvider } from '@/lib/auth/social-sign-in'

const SIGN_UP_MARKER_STORAGE_KEY = 'socialSignUpConversionMarker'

type SignUpConversionMethod = SocialSignInProvider | 'email'

interface SignUpCompletionConversionOptions {
  marker: string | null
  method: SignUpConversionMethod
  userId: string
  measurement: boolean
  marketing: boolean
}

function createSignUpCallbackURL(
  method: SignUpConversionMethod,
  callbackURL: string,
  expectedUserId?: string
): string {
  const marker = generateShortId()
  try {
    const storedMarker = expectedUserId ? `${marker}:${expectedUserId}` : marker
    sessionStorage.setItem(SIGN_UP_MARKER_STORAGE_KEY, storedMarker)
  } catch {}

  const params = new URLSearchParams({
    provider: method,
    callbackURL,
    conversion: marker,
  })
  return `/signup/complete?${params.toString()}`
}

/** Creates Better Auth's new-user-only destination and remembers this browser initiated it. */
export function createSocialSignUpCallbackURL(
  provider: SocialSignInProvider,
  callbackURL: string
): string {
  return createSignUpCallbackURL(provider, callbackURL)
}

/** Defers email conversion reporting until verification proves the returned user is real. */
export function createEmailSignUpCallbackURL(userId: string, callbackURL: string): string {
  return createSignUpCallbackURL('email', callbackURL, userId)
}

function claimSignUpMarker(marker: string | null, userId: string): boolean {
  if (!marker) return false

  try {
    const storedMarker = sessionStorage.getItem(SIGN_UP_MARKER_STORAGE_KEY)
    if (!storedMarker) return false

    const [pendingMarker, expectedUserId] = storedMarker.split(':', 2)
    if (pendingMarker !== marker) return false

    sessionStorage.removeItem(SIGN_UP_MARKER_STORAGE_KEY)
    return !expectedUserId || expectedUserId === userId
  } catch {
    return false
  }
}

/** Claims a new-user marker before reporting so reloads and remounts cannot duplicate the signup. */
export async function trackSignUpCompletionConversions({
  marker,
  method,
  userId,
  measurement,
  marketing,
}: SignUpCompletionConversionOptions): Promise<boolean> {
  if (!claimSignUpMarker(marker, userId)) return false

  await trackSignUpConversions({ method, userId, measurement, marketing })
  return true
}
