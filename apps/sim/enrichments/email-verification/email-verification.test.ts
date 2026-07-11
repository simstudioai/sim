/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { emailVerificationEnrichment } from '@/enrichments/email-verification/email-verification'
import type { EnrichmentProvider } from '@/enrichments/types'

function provider(id: string): EnrichmentProvider {
  const p = emailVerificationEnrichment.providers.find((x) => x.id === id)
  if (!p) throw new Error(`Provider ${id} not found in email-verification cascade`)
  return p
}

const emailInput = { email: '  john@acme.com  ' }

describe('email-verification enrichment cascade', () => {
  it('chains the hosted verifiers in waterfall order', () => {
    expect(emailVerificationEnrichment.providers.map((p) => p.id)).toEqual([
      'zerobounce',
      'neverbounce',
      'millionverifier',
      'enrow',
    ])
  })

  describe('zerobounce', () => {
    const p = provider('zerobounce')
    it('trims the email and falls through on missing/unknown verdict', () => {
      expect(p.toolId).toBe('zerobounce_verify_email')
      expect(p.buildParams(emailInput)).toEqual({ email: 'john@acme.com' })
      expect(p.buildParams({ email: '' })).toBeNull()
      expect(p.mapOutput({ status: 'valid', deliverable: true })).toEqual({
        status: 'valid',
        deliverable: true,
      })
      expect(p.mapOutput({ status: 'unknown', deliverable: false })).toBeNull()
      expect(p.mapOutput({})).toBeNull()
    })
  })

  describe('enrow', () => {
    const p = provider('enrow')
    it('maps the valid/invalid qualifier and falls through otherwise', () => {
      expect(p.toolId).toBe('enrow_verify_email')
      expect(p.buildParams(emailInput)).toEqual({ email: 'john@acme.com' })
      expect(p.buildParams({ email: '' })).toBeNull()
      expect(p.mapOutput({ qualification: 'valid' })).toEqual({
        status: 'valid',
        deliverable: true,
      })
      expect(p.mapOutput({ qualification: 'invalid' })).toEqual({
        status: 'invalid',
        deliverable: false,
      })
      expect(p.mapOutput({ qualification: null })).toBeNull()
      expect(p.mapOutput({})).toBeNull()
    })
  })
})
