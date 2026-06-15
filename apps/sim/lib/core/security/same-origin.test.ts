/**
 * @vitest-environment node
 */
import type { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { isSameOriginBrowserRequest } from '@/lib/core/security/same-origin'
import { getBaseUrl } from '@/lib/core/utils/urls'

function makeRequest(headers: Record<string, string>): NextRequest {
  return { headers: new Headers(headers) } as unknown as NextRequest
}

describe('isSameOriginBrowserRequest', () => {
  it('accepts a same-origin browser fetch', () => {
    expect(isSameOriginBrowserRequest(makeRequest({ 'sec-fetch-site': 'same-origin' }))).toBe(true)
  })

  it('accepts a same-site browser fetch', () => {
    expect(isSameOriginBrowserRequest(makeRequest({ 'sec-fetch-site': 'same-site' }))).toBe(true)
  })

  it('rejects cross-site requests', () => {
    expect(isSameOriginBrowserRequest(makeRequest({ 'sec-fetch-site': 'cross-site' }))).toBe(false)
  })

  it('rejects navigations not initiated from our front-end', () => {
    expect(isSameOriginBrowserRequest(makeRequest({ 'sec-fetch-site': 'none' }))).toBe(false)
  })

  it('falls back to the Origin header when Sec-Fetch-Site is absent', () => {
    const origin = new URL(getBaseUrl()).origin
    expect(isSameOriginBrowserRequest(makeRequest({ origin }))).toBe(true)
  })

  it('rejects a foreign Origin when Sec-Fetch-Site is absent', () => {
    expect(isSameOriginBrowserRequest(makeRequest({ origin: 'https://evil.example.com' }))).toBe(
      false
    )
  })

  it('rejects non-browser callers with neither Sec-Fetch-Site nor Origin', () => {
    expect(isSameOriginBrowserRequest(makeRequest({}))).toBe(false)
  })

  it('trusts the unforgeable Sec-Fetch-Site over a spoofed same-origin Origin', () => {
    const origin = new URL(getBaseUrl()).origin
    expect(
      isSameOriginBrowserRequest(makeRequest({ 'sec-fetch-site': 'cross-site', origin }))
    ).toBe(false)
  })
})
