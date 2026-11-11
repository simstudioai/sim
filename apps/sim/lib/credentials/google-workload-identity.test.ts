/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { googleKeylessOffer } from '@/lib/credentials/google-workload-identity'

describe('keyless setup in the Google service account dialog', () => {
  it.each(['google-drive', 'gmail', 'google-sheets'])(
    'never offers the keyless form when reconnecting a keyless credential from %s',
    (oauthServiceId) => {
      expect(googleKeylessOffer({ oauthServiceId, available: true, reconnectsKeyless: true })).toBe(
        'cloud_only'
      )
    }
  )

  it('offers JSON keys only for a new connection from a Workspace service', () => {
    expect(
      googleKeylessOffer({ oauthServiceId: 'gmail', available: true, reconnectsKeyless: false })
    ).toBe('none')
  })

  it.each([true, false])(
    'offers keyless for BigQuery whether or not the reconnected credential is keyless (%s)',
    (reconnectsKeyless) => {
      expect(
        googleKeylessOffer({
          oauthServiceId: 'google-bigquery',
          available: true,
          reconnectsKeyless,
        })
      ).toBe('offer')
    }
  )

  it('keeps a keyless credential keyless when reconnected from its own page', () => {
    expect(googleKeylessOffer({ available: true, reconnectsKeyless: true })).toBe('offer')
    expect(googleKeylessOffer({ available: true, reconnectsKeyless: false })).toBe('none')
  })

  it('offers nothing keyless where this deployment cannot sign tokens', () => {
    expect(
      googleKeylessOffer({
        oauthServiceId: 'google-bigquery',
        available: false,
        reconnectsKeyless: true,
      })
    ).toBe('none')
  })
})
