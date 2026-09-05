/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { trackGoogleAdsConversion } from '@/lib/analytics/google'
import { GOOGLE_ADS_ID } from '@/lib/consent/scripts'

afterEach(() => {
  window.gtag = undefined
})

describe('trackGoogleAdsConversion', () => {
  it('addresses the conversion to the Ads tag and its registered label', () => {
    const gtag = vi.fn()
    window.gtag = gtag

    trackGoogleAdsConversion('demo_booked')

    expect(gtag).toHaveBeenCalledWith('event', 'conversion', {
      send_to: `${GOOGLE_ADS_ID}/Xt8wCK7b1e4cEL_Zk99C`,
    })
  })

  it('is a no-op when the Google tag has not loaded', () => {
    expect(() => trackGoogleAdsConversion('demo_booked')).not.toThrow()
  })
})
