/**
 * @vitest-environment node
 */
import type { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { isCrossOriginSessionRequest } from '@/lib/core/security/same-origin'
import { getBaseUrl } from '@/lib/core/utils/urls'

function makeRequest(headers: Record<string, string>): NextRequest {
  return { headers: new Headers(headers) } as unknown as NextRequest
}

describe('isCrossOriginSessionRequest', () => {
  it('allows a same-origin browser fetch', () => {
    expect(isCrossOriginSessionRequest(makeRequest({ 'sec-fetch-site': 'same-origin' }))).toBe(
      false
    )
  })

  it('rejects same-site requests (sibling subdomains are not our origin)', () => {
    expect(isCrossOriginSessionRequest(makeRequest({ 'sec-fetch-site': 'same-site' }))).toBe(true)
  })

  it('rejects cross-site requests', () => {
    expect(isCrossOriginSessionRequest(makeRequest({ 'sec-fetch-site': 'cross-site' }))).toBe(true)
  })

  it('rejects navigations not initiated from our front-end', () => {
    expect(isCrossOriginSessionRequest(makeRequest({ 'sec-fetch-site': 'none' }))).toBe(true)
  })

  it('falls back to the Origin header when Sec-Fetch-Site is absent (same-origin allowed)', () => {
    const origin = new URL(getBaseUrl()).origin
    expect(isCrossOriginSessionRequest(makeRequest({ origin }))).toBe(false)
  })

  it('rejects a foreign Origin when Sec-Fetch-Site is absent', () => {
    expect(isCrossOriginSessionRequest(makeRequest({ origin: 'https://evil.example.com' }))).toBe(
      true
    )
  })

  it('allows requests where the origin cannot be determined (no Sec-Fetch-Site, no Origin)', () => {
    expect(isCrossOriginSessionRequest(makeRequest({}))).toBe(false)
  })

  it('trusts the unforgeable Sec-Fetch-Site over a spoofed same-origin Origin', () => {
    const origin = new URL(getBaseUrl()).origin
    expect(
      isCrossOriginSessionRequest(makeRequest({ 'sec-fetch-site': 'cross-site', origin }))
    ).toBe(true)
  })
})
