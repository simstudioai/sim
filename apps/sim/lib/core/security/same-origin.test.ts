import type { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { isCrossSiteSessionRequest } from '@/lib/core/security/same-origin'

function makeRequest(headers: Record<string, string>): NextRequest {
  return { headers: new Headers(headers) } as unknown as NextRequest
}

describe('isCrossSiteSessionRequest', () => {
  it('rejects cross-site requests', () => {
    expect(isCrossSiteSessionRequest(makeRequest({ 'sec-fetch-site': 'cross-site' }))).toBe(true)
  })

  it.each([
    ['same-origin', { 'sec-fetch-site': 'same-origin' }],
    [
      'same-site (sibling subdomains, e.g. www.<domain> -> <domain>)',
      { 'sec-fetch-site': 'same-site' },
    ],
    ['user-initiated (none)', { 'sec-fetch-site': 'none' }],
    ['missing header (older clients)', {}],
  ])('allows %s requests', (_label, headers: Record<string, string>) => {
    expect(isCrossSiteSessionRequest(makeRequest(headers))).toBe(false)
  })
})
