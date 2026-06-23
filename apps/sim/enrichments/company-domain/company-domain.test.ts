/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { companyDomainEnrichment } from '@/enrichments/company-domain/company-domain'
import type { EnrichmentProvider } from '@/enrichments/types'

function provider(id: string): EnrichmentProvider {
  const p = companyDomainEnrichment.providers.find((x) => x.id === id)
  if (!p) throw new Error(`Provider ${id} not found in company-domain cascade`)
  return p
}

const nameInput = { companyName: 'Acme Inc' }

describe('company-domain enrichment cascade', () => {
  it('chains PDL then Datagma', () => {
    expect(companyDomainEnrichment.providers.map((p) => p.id)).toEqual(['pdl', 'datagma'])
  })

  describe('pdl', () => {
    const p = provider('pdl')
    it('matches by name and normalizes the returned website', () => {
      expect(p.toolId).toBe('pdl_company_enrich')
      expect(p.buildParams(nameInput)).toEqual({ name: 'Acme Inc', required: 'website' })
      expect(p.buildParams({ companyName: '' })).toBeNull()
      expect(p.mapOutput({ company: { website: 'https://www.acme.com' } })).toEqual({
        domain: 'acme.com',
      })
      expect(p.mapOutput({ company: {} })).toBeNull()
    })
  })

  describe('datagma', () => {
    const p = provider('datagma')
    it('enriches by company name and normalizes the returned website', () => {
      expect(p.toolId).toBe('datagma_enrich_company')
      expect(p.buildParams(nameInput)).toEqual({ data: 'Acme Inc' })
      expect(p.buildParams({ companyName: '' })).toBeNull()
      expect(p.mapOutput({ website: 'https://www.acme.com/' })).toEqual({ domain: 'acme.com' })
      expect(p.mapOutput({})).toBeNull()
    })
  })
})
