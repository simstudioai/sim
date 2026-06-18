/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { companyInfoEnrichment } from '@/enrichments/company-info/company-info'
import type { EnrichmentProvider } from '@/enrichments/types'

function provider(id: string): EnrichmentProvider {
  const p = companyInfoEnrichment.providers.find((x) => x.id === id)
  if (!p) throw new Error(`Provider ${id} not found in company-info cascade`)
  return p
}

const domainInput = { domain: 'https://www.acme.com/about' }

describe('company-info enrichment cascade', () => {
  it('chains the company-info providers in waterfall order', () => {
    expect(companyInfoEnrichment.providers.map((p) => p.id)).toEqual([
      'hunter',
      'pdl',
      'datagma',
      'leadmagic',
    ])
  })

  describe('hunter', () => {
    const p = provider('hunter')
    it('normalizes the domain and maps size/description', () => {
      expect(p.toolId).toBe('hunter_companies_find')
      expect(p.buildParams(domainInput)).toEqual({ domain: 'acme.com' })
      expect(p.buildParams({ domain: '' })).toBeNull()
      expect(p.mapOutput({ size: '11-50', description: 'Payments' })).toEqual({
        employeeCount: '11-50',
        description: 'Payments',
      })
      expect(p.mapOutput({})).toEqual({})
    })
  })

  describe('datagma', () => {
    const p = provider('datagma')
    it('passes the normalized domain as data and maps companySize/shortDescription', () => {
      expect(p.toolId).toBe('datagma_enrich_company')
      expect(p.buildParams(domainInput)).toEqual({ data: 'acme.com' })
      expect(p.buildParams({ domain: '' })).toBeNull()
      expect(p.mapOutput({ companySize: '11-50', shortDescription: 'Payments' })).toEqual({
        employeeCount: '11-50',
        description: 'Payments',
      })
      expect(p.mapOutput({})).toEqual({})
    })
  })

  describe('leadmagic', () => {
    const p = provider('leadmagic')
    it('searches by domain and prefers the headcount range', () => {
      expect(p.toolId).toBe('leadmagic_company_search')
      expect(p.buildParams(domainInput)).toEqual({ company_domain: 'acme.com' })
      expect(p.buildParams({ domain: '' })).toBeNull()
      expect(
        p.mapOutput({ employeeRange: '11-50', employeeCount: 42, description: 'Pay' })
      ).toEqual({ employeeCount: '11-50', description: 'Pay' })
      expect(p.mapOutput({ employeeCount: 42 })).toEqual({ employeeCount: '42' })
      expect(p.mapOutput({})).toEqual({})
    })
  })
})
