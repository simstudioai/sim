/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import {
  buildDelegatedOAuthRequest,
  isValidOAuthCodeVerifier,
  parseOAuthFormRequest,
  validateOAuthPkceAuthorizationRequest,
} from '@/lib/auth/oauth-protocol-request'

function request(body: string, headers: HeadersInit = {}): NextRequest {
  return new NextRequest('https://sim.test/api/auth/oauth2/token', {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
  })
}

describe('parseOAuthFormRequest', () => {
  it('parses public and client-secret-post credentials', async () => {
    const publicResult = await parseOAuthFormRequest(request('client_id=sim-cli'))
    expect(publicResult.success && publicResult.value.credentials).toEqual({
      clientId: 'sim-cli',
      method: 'none',
    })

    const confidentialResult = await parseOAuthFormRequest(
      request('client_id=web&client_secret=secret')
    )
    expect(confidentialResult.success && confidentialResult.value.credentials).toEqual({
      clientId: 'web',
      clientSecret: 'secret',
      method: 'client_secret_post',
    })
  })

  it('accepts a case-insensitive Basic scheme and decodes form-escaped credentials', async () => {
    const encoded = Buffer.from('client%2Bid:s%3Aecret').toString('base64')
    const result = await parseOAuthFormRequest(
      request('grant_type=refresh_token', { authorization: `basic ${encoded}` })
    )
    expect(result.success && result.value.credentials).toEqual({
      clientId: 'client+id',
      clientSecret: 's:ecret',
      method: 'client_secret_basic',
    })
  })

  it('adapts decoded Basic credentials to Better Auth without changing grant fields', async () => {
    const encoded = Buffer.from('client%2Bid:s%3Aecret').toString('base64')
    const original = request('grant_type=authorization_code&code=code', {
      authorization: `basic ${encoded}`,
    })
    const parsed = await parseOAuthFormRequest(original)
    if (!parsed.success) throw new Error('request should parse')
    const delegated = buildDelegatedOAuthRequest(original, parsed.value)
    const delegatedForm = new URLSearchParams(await delegated.text())

    expect(delegated.headers.has('authorization')).toBe(false)
    expect(delegatedForm.get('grant_type')).toBe('authorization_code')
    expect(delegatedForm.get('code')).toBe('code')
    expect(delegatedForm.get('client_id')).toBe('client+id')
    expect(delegatedForm.get('client_secret')).toBe('s:ecret')
  })

  it('rejects repeated fields and mixed client authentication', async () => {
    const repeated = await parseOAuthFormRequest(request('client_id=a&client_id=b'))
    expect(repeated.success).toBe(false)
    if (!repeated.success) expect(repeated.response.status).toBe(400)

    const encoded = Buffer.from('client:secret').toString('base64')
    const mixed = await parseOAuthFormRequest(
      request('client_secret=other', { authorization: `Basic ${encoded}` })
    )
    expect(mixed.success).toBe(false)
    if (!mixed.success) {
      await expect(mixed.response.json()).resolves.toMatchObject({ error: 'invalid_request' })
    }
  })

  it('rejects malformed authorization, content types, and oversized bodies', async () => {
    const malformed = await parseOAuthFormRequest(
      request('client_id=a', { authorization: 'Basic not base64!' })
    )
    expect(malformed.success).toBe(false)
    if (!malformed.success) {
      expect(malformed.response.status).toBe(401)
      expect(malformed.response.headers.get('www-authenticate')).toContain('Basic')
    }

    const json = await parseOAuthFormRequest(
      new NextRequest('https://sim.test/api/auth/oauth2/token', {
        method: 'POST',
        body: '{}',
        headers: { 'content-type': 'application/json' },
      })
    )
    expect(json.success).toBe(false)

    const misleadingContentType = await parseOAuthFormRequest(
      request('client_id=a', { 'content-type': 'application/x-www-form-urlencoded-json' })
    )
    expect(misleadingContentType.success).toBe(false)

    const oversized = await parseOAuthFormRequest(request(`scope=${'a'.repeat(16_385)}`))
    expect(oversized.success).toBe(false)

    const oversizedMultibyte = await parseOAuthFormRequest(request(`scope=${'é'.repeat(8_193)}`))
    expect(oversizedMultibyte.success).toBe(false)
  })

  it('reports invalid UTF-8 separately from an oversized body', async () => {
    const invalidUtf8 = await parseOAuthFormRequest(
      new NextRequest('https://sim.test/api/auth/oauth2/token', {
        method: 'POST',
        body: new Uint8Array([0xc3, 0x28]),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      })
    )
    expect(invalidUtf8.success).toBe(false)
    if (!invalidUtf8.success) {
      await expect(invalidUtf8.response.json()).resolves.toMatchObject({
        error: 'invalid_request',
        error_description: 'OAuth request body must be valid UTF-8.',
      })
    }
  })
})

describe('OAuth PKCE validation', () => {
  it('accepts the RFC 7636 verifier alphabet and length bounds', () => {
    expect(isValidOAuthCodeVerifier('a'.repeat(43))).toBe(true)
    expect(isValidOAuthCodeVerifier(`${'a'.repeat(124)}._~-`)).toBe(true)
    expect(isValidOAuthCodeVerifier('a'.repeat(42))).toBe(false)
    expect(isValidOAuthCodeVerifier('a'.repeat(129))).toBe(false)
    expect(isValidOAuthCodeVerifier(`${'a'.repeat(42)}=`)).toBe(false)
  })

  it('accepts only paired, canonical S256 authorization parameters', async () => {
    expect(
      validateOAuthPkceAuthorizationRequest(
        new URLSearchParams({
          code_challenge: 'a'.repeat(43),
          code_challenge_method: 'S256',
        })
      )
    ).toBeNull()

    for (const params of [
      new URLSearchParams({ code_challenge: 'a'.repeat(43) }),
      new URLSearchParams({ code_challenge_method: 'S256' }),
      new URLSearchParams({ code_challenge: 'a'.repeat(42), code_challenge_method: 'S256' }),
      new URLSearchParams({ code_challenge: 'a'.repeat(43), code_challenge_method: 'plain' }),
    ]) {
      expect(validateOAuthPkceAuthorizationRequest(params)).toEqual(expect.any(String))
    }
  })
})
