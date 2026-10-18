/**
 * @vitest-environment jsdom
 * @vitest-environment-options {"url":"https://www.sim.ai/signup"}
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createSocialSignUpCallbackURL,
  trackSocialSignUpConversions,
} from '@/lib/auth/social-sign-up-conversion'

afterEach(() => {
  sessionStorage.clear()
  window.twq = undefined
  window.freebuff = undefined
  window.gtag = undefined
})

function getConversionMarker(callbackURL: string): string {
  return new URL(callbackURL, window.location.origin).searchParams.get('conversion') ?? ''
}

describe('social signup conversions', () => {
  it('reports a new social user once', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const trackXEvent = vi.fn()
    const trackGoogleEvent = vi.fn()
    const trackFreebuffEvent = vi.fn()
    window.twq = trackXEvent
    window.gtag = trackGoogleEvent
    window.freebuff = trackFreebuffEvent
    const marker = getConversionMarker(createSocialSignUpCallbackURL('google', '/workspace'))

    const firstReport = await trackSocialSignUpConversions({
      marker,
      provider: 'google',
      userId: 'user-1',
      measurement: true,
      marketing: true,
    })
    const duplicateReport = await trackSocialSignUpConversions({
      marker,
      provider: 'google',
      userId: 'user-1',
      measurement: true,
      marketing: true,
    })

    expect(firstReport).toBe(true)
    expect(duplicateReport).toBe(false)
    expect(trackXEvent).toHaveBeenCalledOnce()
    expect(trackGoogleEvent).toHaveBeenCalledWith(
      'event',
      'sign_up',
      expect.objectContaining({ method: 'google' })
    )
    expect(trackFreebuffEvent).toHaveBeenCalledOnce()
  })

  it(
    'does not report a returning social login that lacks the new-user callback marker',
    async () => {
      const trackXEvent = vi.fn()
      window.twq = trackXEvent
      createSocialSignUpCallbackURL('github', '/workspace')

      const reported = await trackSocialSignUpConversions({
        marker: 'not-the-pending-new-user-marker',
        provider: 'github',
        userId: 'user-1',
        measurement: true,
        marketing: true,
      })

      expect(reported).toBe(false)
      expect(trackXEvent).not.toHaveBeenCalled()
    }
  )
})
