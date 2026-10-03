import { describe, expect, it } from 'vitest'
import { phoneNumberEnrichment } from '@/enrichments/phone-number/phone-number'
import type { EnrichmentProvider } from '@/enrichments/types'

function provider(id: string): EnrichmentProvider {
  const p = phoneNumberEnrichment.providers.find((x) => x.id === id)
  if (!p) throw new Error(`Provider ${id} not found in phone-number cascade`)
  return p
}

const nameDomain = { fullName: 'John Doe', companyDomain: 'https://www.acme.com/careers' }
const linkedinOnly = { fullName: 'John Doe', linkedinUrl: 'https://linkedin.com/in/johndoe' }

describe('phone-number enrichment cascade', () => {
  describe('findymail', () => {
    const p = provider('findymail')
    it('keys off the LinkedIn URL and skips without one', () => {
      expect(p.toolId).toBe('findymail_find_phone')
      expect(p.buildParams(linkedinOnly)).toEqual({
        linkedin_url: 'https://linkedin.com/in/johndoe',
      })
      expect(p.buildParams(nameDomain)).toBeNull()
      expect(p.mapOutput({ phone: '+1555' })).toEqual({ phone: '+1555' })
      expect(p.mapOutput({ phone: null })).toBeNull()
    })
  })

  describe('prospeo (opportunistic)', () => {
    const p = provider('prospeo')
    it('recognizes only Prospeo NO_MATCH as a clean miss', () => {
      expect(
        p.projectFailure({
          error: 'NO_MATCH',
          output: { status: 400, data: { error: true, error_code: 'NO_MATCH' } },
        })
      ).toEqual({ status: 'no_match' })
      expect(
        p.projectFailure({
          error: 'INVALID_API_KEY',
          output: { status: 400, data: { error: true, error_code: 'INVALID_API_KEY' } },
        })
      ).toEqual({ status: 'error', error: 'INVALID_API_KEY' })
      expect(
        p.projectFailure({
          error: 'Bad Request',
          output: { status: 400, data: { error: true } },
        })
      ).toEqual({ status: 'error', error: 'Bad Request' })
    })
  })
})
