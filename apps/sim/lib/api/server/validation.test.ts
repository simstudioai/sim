/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MAX_JSON_BODY_BYTES,
  parseJsonBody,
  parseOptionalJsonBody,
} from '@/lib/api/server/validation'

/**
 * Next.js truncates a proxied client body past `experimental.proxyClientMaxBodySize`
 * without signalling it, so this is the largest body a handler can actually receive.
 */
const PROXY_CLIENT_MAX_BODY_BYTES = 10 * 1024 * 1024

/** Mirrors `MAX_WORKSPACE_FILE_INLINE_BODY_BYTES` — an explicit override above the ceiling. */
const INLINE_FILE_BODY_BYTES = 70 * 1024 * 1024

/** Mirrors the knowledge-search override — below the ceiling, so the clamp must not touch it. */
const BELOW_CEILING_BODY_BYTES = 2 * 1024 * 1024

/**
 * Declares `content-length` independently of the bytes actually attached, which is
 * how the guard sees an oversized request without buffering one in the test.
 */
function requestDeclaring(contentLength: number, body: string): NextRequest {
  return new NextRequest('http://localhost/api/v2/widgets', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-length': String(contentLength),
    },
    body,
  })
}

describe('DEFAULT_MAX_JSON_BODY_BYTES', () => {
  it('never exceeds the body size the proxy will forward intact', () => {
    expect(DEFAULT_MAX_JSON_BODY_BYTES).toBeLessThanOrEqual(PROXY_CLIENT_MAX_BODY_BYTES)
  })
})

describe('parseJsonBody default size boundary', () => {
  it('accepts a body at the proxy cap', async () => {
    const result = await parseJsonBody(
      requestDeclaring(PROXY_CLIENT_MAX_BODY_BYTES, JSON.stringify({ value: 'ok' }))
    )

    expect(result.success).toBe(true)
  })

  it('accepts a body just under the proxy cap', async () => {
    const result = await parseJsonBody(
      requestDeclaring(PROXY_CLIENT_MAX_BODY_BYTES - 1, JSON.stringify({ value: 'ok' }))
    )

    expect(result.success).toBe(true)
  })

  it('rejects a body just over the proxy cap as too large, not as malformed', async () => {
    const result = await parseJsonBody(
      requestDeclaring(PROXY_CLIENT_MAX_BODY_BYTES + 1, JSON.stringify({ value: 'ok' }))
    )

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.reason).toBe('too_large')
    expect(result.response.status).toBe(413)
  })

  it('rejects an explicit over-ceiling override the same way, quoting the enforced limit', async () => {
    const result = await parseJsonBody(
      requestDeclaring(PROXY_CLIENT_MAX_BODY_BYTES + 1, JSON.stringify({ value: 'ok' })),
      'response',
      INLINE_FILE_BODY_BYTES
    )

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.reason).toBe('too_large')
    expect(result.response.status).toBe(413)
    await expect(result.response.json()).resolves.toEqual({
      error: `Request body exceeds the maximum allowed size of ${PROXY_CLIENT_MAX_BODY_BYTES} bytes`,
    })
  })

  it('still accepts a body at the ceiling under an over-ceiling override', async () => {
    const result = await parseJsonBody(
      requestDeclaring(PROXY_CLIENT_MAX_BODY_BYTES, JSON.stringify({ value: 'ok' })),
      'response',
      INLINE_FILE_BODY_BYTES
    )

    expect(result.success).toBe(true)
  })

  it('leaves an override below the ceiling exactly as declared', async () => {
    const atLimit = await parseJsonBody(
      requestDeclaring(BELOW_CEILING_BODY_BYTES, JSON.stringify({ value: 'ok' })),
      'response',
      BELOW_CEILING_BODY_BYTES
    )
    expect(atLimit.success).toBe(true)

    const overLimit = await parseJsonBody(
      requestDeclaring(BELOW_CEILING_BODY_BYTES + 1, JSON.stringify({ value: 'ok' })),
      'response',
      BELOW_CEILING_BODY_BYTES
    )
    expect(overLimit.success).toBe(false)
    if (overLimit.success) return
    expect(overLimit.reason).toBe('too_large')
    await expect(overLimit.response.json()).resolves.toEqual({
      error: `Request body exceeds the maximum allowed size of ${BELOW_CEILING_BODY_BYTES} bytes`,
    })
  })

  it('applies the same clamp to an optional body', async () => {
    const result = await parseOptionalJsonBody(
      requestDeclaring(PROXY_CLIENT_MAX_BODY_BYTES + 1, JSON.stringify({ value: 'ok' })),
      INLINE_FILE_BODY_BYTES
    )

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.reason).toBe('too_large')
    expect(result.response.status).toBe(413)
  })

  it('still reports a genuinely malformed body as malformed', async () => {
    const result = await parseJsonBody(requestDeclaring(7, '{"a":  '))

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.reason).toBe('invalid_json')
    expect(result.response.status).toBe(400)
    await expect(result.response.json()).resolves.toEqual({
      error: 'Request body must be valid JSON',
    })
  })
})
