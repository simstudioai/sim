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

const nameDomain = { fullName: 'John Doe', companyDomain: 'https://www.acme.com/careers' }
const linkedinOnly = { fullName: 'John Doe', linkedinUrl: 'https://linkedin.com/in/johndoe' }

describe('phone-number enrichment cascade', () => {
  it('chains PDL then the phone-capable hosted providers', () => {
    expect(phoneNumberEnrichment.providers.map((p) => p.id)).toEqual([
      'pdl',
      'wiza',
      'findymail',
      'prospeo',
    ])
  })

  describe('wiza (opportunistic)', () => {
    const p = provider('wiza')
    it('reveals phone, using name+domain or LinkedIn profile_url', () => {
      expect(p.toolId).toBe('wiza_individual_reveal')
      expect(p.buildParams(nameDomain)).toEqual({
        full_name: 'John Doe',
        domain: 'acme.com',
        enrichment_level: 'phone',
      })
      expect(p.buildParams(linkedinOnly)).toEqual({
        full_name: 'John Doe',
        profile_url: 'https://linkedin.com/in/johndoe',
        enrichment_level: 'phone',
      })
      expect(p.buildParams({ fullName: 'John Doe' })).toBeNull()
      expect(p.mapOutput({ mobile_phone: '+1555', phones: [] })).toEqual({ phone: '+1555' })
      expect(p.mapOutput({ phones: [{ number: '+1777' }] })).toEqual({ phone: '+1777' })
    })
  })

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
    it('requests mobile enrichment via name+domain or LinkedIn', () => {
      expect(p.toolId).toBe('prospeo_enrich_person')
      expect(p.buildParams(nameDomain)).toEqual({
        full_name: 'John Doe',
        company_website: 'acme.com',
        enrich_mobile: true,
      })
      expect(p.buildParams(linkedinOnly)).toEqual({
        full_name: 'John Doe',
        linkedin_url: 'https://linkedin.com/in/johndoe',
        enrich_mobile: true,
      })
      expect(p.buildParams({ fullName: 'John Doe' })).toBeNull()
      expect(p.mapOutput({ person: { mobile: { mobile: '+1555' } } })).toEqual({ phone: '+1555' })
    })
  })
})
