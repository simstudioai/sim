/**
 * @vitest-environment jsdom
 * @vitest-environment-options {"url":"https://www.sim.ai/signup"}
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { trackSignUpConversions } from '@/lib/analytics/sign-up'

afterEach(() => {
  Reflect.deleteProperty(window, 'twq')
  Reflect.deleteProperty(window, 'freebuff')
  Reflect.deleteProperty(window, 'gtag')
})

describe('email signup conversions', () => {
  it('reports the X signup event when marketing consent is granted', async () => {
    const trackXEvent = vi.fn()
    window.twq = trackXEvent

    await trackSignUpConversions({
      method: 'email',
      userId: 'user-1',
      measurement: false,
      marketing: true,
    })

    expect(trackXEvent).toHaveBeenCalledOnce()
    expect(trackXEvent).toHaveBeenCalledWith('event', 'tw-q5xbl-rhis8', {})
  })

  it('does not report the X signup event without marketing consent', async () => {
    const trackXEvent = vi.fn()
    window.twq = trackXEvent

    await trackSignUpConversions({
      method: 'email',
      userId: 'user-1',
      measurement: true,
      marketing: false,
    })

    expect(trackXEvent).not.toHaveBeenCalled()
  })
})
