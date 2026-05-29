/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { phoneNumberEnrichment } from '@/enrichments/phone-number/phone-number'
import type { EnrichmentProvider } from '@/enrichments/types'

function provider(id: string): EnrichmentProvider {
  const p = phoneNumberEnrichment.providers.find((x) => x.id === id)
  if (!p) throw new Error(`Provider ${id} not found in phone-number cascade`)
  return p
}

const inputs = { fullName: 'John Doe', companyDomain: 'https://www.acme.com/careers' }

describe('phone-number enrichment cascade', () => {
  it('chains PDL then the phone-capable hosted providers', () => {
    expect(phoneNumberEnrichment.providers.map((p) => p.id)).toEqual(['pdl', 'wiza', 'prospeo'])
  })

  describe('wiza', () => {
    const p = provider('wiza')
    it('reveals phone (5 credits) and maps mobile_phone/phones', () => {
      expect(p.toolId).toBe('wiza_individual_reveal')
      expect(p.buildParams(inputs)).toEqual({
        full_name: 'John Doe',
        domain: 'acme.com',
        enrichment_level: 'phone',
      })
      expect(p.mapOutput({ mobile_phone: '+1555', phones: [] })).toEqual({ phone: '+1555' })
      expect(p.mapOutput({ phones: [{ number: '+1777' }] })).toEqual({ phone: '+1777' })
      expect(p.mapOutput({ mobile_phone: null, phone_number: null, phones: [] })).toBeNull()
    })
    it('skips without a company domain', () => {
      expect(p.buildParams({ fullName: 'John Doe', companyDomain: '' })).toBeNull()
    })
  })

  describe('prospeo', () => {
    const p = provider('prospeo')
    it('requests mobile enrichment and maps person.mobile.mobile', () => {
      expect(p.toolId).toBe('prospeo_enrich_person')
      expect(p.buildParams(inputs)).toEqual({
        full_name: 'John Doe',
        company_website: 'acme.com',
        enrich_mobile: true,
      })
      expect(p.mapOutput({ person: { mobile: { mobile: '+1555', status: 'VERIFIED' } } })).toEqual({
        phone: '+1555',
      })
      expect(p.mapOutput({ person: { mobile: { mobile: '' } } })).toBeNull()
    })
    it('skips without a company domain', () => {
      expect(p.buildParams({ fullName: 'John Doe', companyDomain: '' })).toBeNull()
    })
  })
})
