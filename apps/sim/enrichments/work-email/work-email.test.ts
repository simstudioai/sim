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
    it('projects Prospeo NO_MATCH as a clean miss without hiding genuine errors', () => {
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
    })
  })
})
