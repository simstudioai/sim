/**
 * @vitest-environment jsdom
 * @vitest-environment-options {"url":"https://www.sim.ai/signup"}
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createEmailSignUpCallbackURL,
  createSocialSignUpCallbackURL,
  trackSignUpCompletionConversions,
} from '@/lib/auth/social-sign-up-conversion'

afterEach(() => {
  sessionStorage.clear()
  Reflect.deleteProperty(window, 'twq')
  Reflect.deleteProperty(window, 'freebuff')
  Reflect.deleteProperty(window, 'gtag')
})

function getConversionMarker(callbackURL: string): string {
  return new URL(callbackURL, window.location.origin).searchParams.get('conversion') ?? ''
}

describe('signup completion conversions', () => {
  it('reports a new social user once', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const trackXEvent = vi.fn()
    const trackGoogleEvent = vi.fn()
    const trackFreebuffEvent = vi.fn()
    window.twq = trackXEvent
    window.gtag = trackGoogleEvent
    window.freebuff = trackFreebuffEvent
    const marker = getConversionMarker(createSocialSignUpCallbackURL('google', '/workspace'))

    const firstReport = await trackSignUpCompletionConversions({
      marker,
      method: 'google',
      userId: 'user-1',
      measurement: true,
      marketing: true,
    })
    const duplicateReport = await trackSignUpCompletionConversions({
      marker,
      method: 'google',
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

  it('does not report a returning social login that lacks the new-user callback marker', async () => {
    const trackXEvent = vi.fn()
    window.twq = trackXEvent
    createSocialSignUpCallbackURL('github', '/workspace')

    const reported = await trackSignUpCompletionConversions({
      marker: 'not-the-pending-new-user-marker',
      method: 'github',
      userId: 'user-1',
      measurement: true,
      marketing: true,
    })

    expect(reported).toBe(false)
    expect(trackXEvent).not.toHaveBeenCalled()
  })

  it('does not report a duplicate email signup with a synthetic user ID', async () => {
    const trackXEvent = vi.fn()
    window.twq = trackXEvent
    const marker = getConversionMarker(createEmailSignUpCallbackURL('synthetic-user', '/workspace'))

    const reported = await trackSignUpCompletionConversions({
      marker,
      method: 'email',
      userId: 'existing-user',
      measurement: true,
      marketing: true,
    })

    expect(reported).toBe(false)
    expect(trackXEvent).not.toHaveBeenCalled()
  })
})
