import { sleep } from '@sim/utils/helpers'
import { trackFreebuffConversion } from '@/lib/analytics/freebuff'
import { trackGoogleEvent } from '@/lib/analytics/google'
import { X_SIGN_UP_EVENT_ID } from '@/lib/consent/scripts'

const X_PIXEL_STUB_WAIT_INTERVAL_MS = 50
const X_PIXEL_STUB_WAIT_ATTEMPTS = 20

interface TrackSignUpConversionsOptions {
  method: string
  userId: string
  measurement: boolean
  marketing: boolean
}

async function trackXSignUpConversion(): Promise<void> {
  for (let attempt = 0; attempt < X_PIXEL_STUB_WAIT_ATTEMPTS; attempt += 1) {
    if (typeof window.twq === 'function') {
      window.twq('event', X_SIGN_UP_EVENT_ID, {})
      return
    }
    await sleep(X_PIXEL_STUB_WAIT_INTERVAL_MS)
  }
}

/** Reports a completed signup only to vendors allowed by the settled consent state. */
export async function trackSignUpConversions({
  method,
  userId,
  measurement,
  marketing,
}: TrackSignUpConversionsOptions): Promise<void> {
  if (measurement) trackGoogleEvent('sign_up', { method })
  if (!marketing) return

  trackFreebuffConversion('signup_completed', userId)
  await trackXSignUpConversion()
}
