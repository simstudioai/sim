/**
 * @vitest-environment node
 */
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

  it('allows same-origin browser fetches', () => {
    expect(isCrossSiteSessionRequest(makeRequest({ 'sec-fetch-site': 'same-origin' }))).toBe(false)
  })

  it('allows same-site fetches (sibling subdomains, e.g. www.<domain> -> <domain>)', () => {
    expect(isCrossSiteSessionRequest(makeRequest({ 'sec-fetch-site': 'same-site' }))).toBe(false)
  })

  it('allows user-initiated requests (Sec-Fetch-Site: none)', () => {
    expect(isCrossSiteSessionRequest(makeRequest({ 'sec-fetch-site': 'none' }))).toBe(false)
  })

  it('allows requests with no Sec-Fetch-Site header (older clients)', () => {
    expect(isCrossSiteSessionRequest(makeRequest({}))).toBe(false)
  })
})
