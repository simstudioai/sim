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

const inputs = { fullName: 'John Doe', companyDomain: 'https://www.acme.com/careers' }

describe('work-email enrichment cascade', () => {
  it('chains the five hosted providers in waterfall order', () => {
    expect(workEmailEnrichment.providers.map((p) => p.id)).toEqual([
      'hunter',
      'findymail',
      'prospeo',
      'wiza',
      'pdl',
    ])
  })

  describe('findymail', () => {
    const p = provider('findymail')
    it('maps name + normalized domain and extracts contact.email', () => {
      expect(p.toolId).toBe('findymail_find_email_from_name')
      expect(p.buildParams(inputs)).toEqual({ name: 'John Doe', domain: 'acme.com' })
      expect(p.mapOutput({ contact: { email: 'j@acme.com' } })).toEqual({ email: 'j@acme.com' })
      expect(p.mapOutput({ contact: null })).toBeNull()
    })
    it('skips when name or domain is missing', () => {
      expect(p.buildParams({ fullName: '', companyDomain: 'acme.com' })).toBeNull()
      expect(p.buildParams({ fullName: 'John Doe', companyDomain: '' })).toBeNull()
    })
  })

  describe('prospeo', () => {
    const p = provider('prospeo')
    it('maps full_name + company_website and extracts person.email.email', () => {
      expect(p.toolId).toBe('prospeo_enrich_person')
      expect(p.buildParams(inputs)).toEqual({ full_name: 'John Doe', company_website: 'acme.com' })
      expect(
        p.mapOutput({ person: { email: { email: 'j@acme.com', status: 'VERIFIED' } } })
      ).toEqual({
        email: 'j@acme.com',
      })
      expect(p.mapOutput({ free_enrichment: true, person: null })).toBeNull()
    })
  })

  describe('wiza', () => {
    const p = provider('wiza')
    it('reveals email-only (partial) and maps output.email', () => {
      expect(p.toolId).toBe('wiza_individual_reveal')
      expect(p.buildParams(inputs)).toEqual({
        full_name: 'John Doe',
        domain: 'acme.com',
        enrichment_level: 'partial',
      })
      expect(p.mapOutput({ email: 'j@acme.com', email_status: 'valid' })).toEqual({
        email: 'j@acme.com',
      })
      expect(p.mapOutput({ email: null })).toBeNull()
    })
  })
})
