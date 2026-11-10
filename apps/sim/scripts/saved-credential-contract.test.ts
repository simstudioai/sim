import { describe, expect, it } from 'vitest'
import { hostSteeringParams } from '@/scripts/saved-credential-contract'

const required = { type: 'string', required: true }
const optional = { type: 'string', required: false }

describe('hostSteeringParams', () => {
  it('finds an unvalidated host param that becomes the request origin', () => {
    const tool = {
      params: { apiKey: required, indexHost: required, id: required },
      request: {
        url: (p: Record<string, string>) => `https://${p.indexHost}/vectors/${p.id}`,
      },
    }

    expect(hostSteeringParams(tool)).toEqual({ params: ['indexHost'], probed: true })
  })

  it('finds a param holding a whole base URL', () => {
    const tool = {
      params: { baseUrl: optional, id: required },
      request: {
        url: (p: Record<string, string>) =>
          `${p.baseUrl ?? 'https://api.example.com'}/items/${p.id}`,
      },
    }

    expect(hostSteeringParams(tool).params).toEqual(['baseUrl'])
  })

  it('ignores params that only reach the path or query', () => {
    const tool = {
      params: { domain: required, companyId: required },
      request: {
        url: (p: Record<string, string>) =>
          `https://api.example.com/companies/${p.companyId}?domain=${encodeURIComponent(p.domain)}`,
      },
    }

    expect(hostSteeringParams(tool)).toEqual({ params: [], probed: true })
  })

  it('falls back to destination-like names when no placeholder builds the URL', () => {
    const tool = {
      params: { serverUrl: required, query: required },
      request: {
        url: () => {
          throw new Error('validated elsewhere')
        },
      },
    }

    expect(hostSteeringParams(tool)).toEqual({ params: ['serverUrl'], probed: false })
  })
})
