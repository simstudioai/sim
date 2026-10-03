import { describe, expect, it } from 'vitest'
import { linkedinProfileEnrichment } from '@/enrichments/linkedin-profile/linkedin-profile'
import type { EnrichmentProvider } from '@/enrichments/types'

function provider(id: string): EnrichmentProvider {
  const match = linkedinProfileEnrichment.providers.find((candidate) => candidate.id === id)
  if (!match) throw new Error(`Provider ${id} not found in linkedin-profile cascade`)
  return match
}

const allInputs = {
  fullName: 'Jane Doe',
  email: 'jane@acme.com',
  companyName: 'Acme Inc',
  companyDomain: 'https://www.acme.com/careers',
}

describe('linkedin-profile enrichment cascade', () => {
  it('uses email-only reverse lookup providers only when email is available', () => {
    expect(provider('findymail').buildParams(allInputs)).toEqual({ email: 'jane@acme.com' })
    expect(provider('leadmagic').buildParams(allInputs)).toEqual({ work_email: 'jane@acme.com' })
    expect(provider('findymail').buildParams({ fullName: 'Jane Doe' })).toBeNull()
    expect(provider('leadmagic').buildParams({ fullName: 'Jane Doe' })).toBeNull()
  })

  it('treats Prospeo NO_MATCH as a clean miss without hiding real errors', () => {
    const prospeo = provider('prospeo')
    expect(
      prospeo.projectFailure({
        error: 'NO_MATCH',
        output: { status: 400, data: { error: true, error_code: 'NO_MATCH' } },
      })
    ).toEqual({ status: 'no_match' })
    expect(
      prospeo.projectFailure({
        error: 'INVALID_API_KEY',
        output: { status: 400, data: { error: true, error_code: 'INVALID_API_KEY' } },
      })
    ).toEqual({ status: 'error', error: 'INVALID_API_KEY' })
  })

  it('requires PDL to return a LinkedIn URL and uses the strongest company key', () => {
    const pdl = provider('pdl')
    expect(pdl.buildParams(allInputs)).toEqual({
      email: 'jane@acme.com',
      name: 'Jane Doe',
      company: 'acme.com',
      min_likelihood: 6,
      required: 'linkedin_url',
    })
    expect(pdl.buildParams({ fullName: 'Jane Doe', companyName: 'Acme Inc' })).toEqual({
      name: 'Jane Doe',
      company: 'Acme Inc',
      min_likelihood: 6,
      required: 'linkedin_url',
    })
    expect(pdl.buildParams({ fullName: 'Jane Doe' })).toBeNull()
  })
})
