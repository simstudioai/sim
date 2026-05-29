/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { EnrichmentProvider } from '@/enrichments/types'
import { workEmailEnrichment } from '@/enrichments/work-email/work-email'

function provider(id: string): EnrichmentProvider {
  const p = workEmailEnrichment.providers.find((x) => x.id === id)
  if (!p) throw new Error(`Provider ${id} not found in work-email cascade`)
  return p
}

const nameDomain = { fullName: 'John Doe', companyDomain: 'https://www.acme.com/careers' }
const linkedinOnly = { fullName: 'John Doe', linkedinUrl: 'https://linkedin.com/in/johndoe' }

describe('work-email enrichment cascade', () => {
  it('chains the hosted providers in waterfall order', () => {
    expect(workEmailEnrichment.providers.map((p) => p.id)).toEqual([
      'hunter',
      'findymail',
      'findymail-linkedin',
      'prospeo',
      'wiza',
      'pdl',
    ])
  })

  describe('findymail (name)', () => {
    const p = provider('findymail')
    it('maps name + domain and extracts contact.email', () => {
      expect(p.toolId).toBe('findymail_find_email_from_name')
      expect(p.buildParams(nameDomain)).toEqual({ name: 'John Doe', domain: 'acme.com' })
      expect(p.mapOutput({ contact: { email: 'j@acme.com' } })).toEqual({ email: 'j@acme.com' })
      expect(p.buildParams(linkedinOnly)).toBeNull()
    })
  })

  describe('findymail-linkedin', () => {
    const p = provider('findymail-linkedin')
    it('keys off the LinkedIn URL and skips without one', () => {
      expect(p.toolId).toBe('findymail_find_email_from_linkedin')
      expect(p.buildParams(linkedinOnly)).toEqual({
        linkedin_url: 'https://linkedin.com/in/johndoe',
      })
      expect(p.buildParams(nameDomain)).toBeNull()
      expect(p.mapOutput({ contact: { email: 'j@acme.com' } })).toEqual({ email: 'j@acme.com' })
    })
  })

  describe('prospeo (opportunistic)', () => {
    const p = provider('prospeo')
    it('uses name+domain, or LinkedIn when present', () => {
      expect(p.buildParams(nameDomain)).toEqual({
        full_name: 'John Doe',
        company_website: 'acme.com',
      })
      expect(p.buildParams(linkedinOnly)).toEqual({
        full_name: 'John Doe',
        linkedin_url: 'https://linkedin.com/in/johndoe',
      })
      expect(p.buildParams({ fullName: 'John Doe' })).toBeNull()
      expect(p.mapOutput({ person: { email: { email: 'j@acme.com' } } })).toEqual({
        email: 'j@acme.com',
      })
    })
  })

  describe('wiza (opportunistic)', () => {
    const p = provider('wiza')
    it('reveals email-only (partial), preferring LinkedIn profile_url', () => {
      expect(p.buildParams(nameDomain)).toEqual({
        full_name: 'John Doe',
        domain: 'acme.com',
        enrichment_level: 'partial',
      })
      expect(p.buildParams(linkedinOnly)).toEqual({
        full_name: 'John Doe',
        profile_url: 'https://linkedin.com/in/johndoe',
        enrichment_level: 'partial',
      })
      expect(p.buildParams({ fullName: 'John Doe' })).toBeNull()
      expect(p.mapOutput({ email: 'j@acme.com' })).toEqual({ email: 'j@acme.com' })
    })
  })
})
