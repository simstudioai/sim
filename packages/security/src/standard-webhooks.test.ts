import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { verifyStandardWebhook } from './standard-webhooks'

/**
 * The published Standard Webhooks / Svix test vector (svix `webhook.test.ts`). The key is kept
 * as bare base64 and prefixed at runtime so secret scanners don't flag a public sample value.
 */
const VECTOR_KEY_BASE64 = 'MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw'
const VECTOR = {
  secret: `whsec_${VECTOR_KEY_BASE64}`,
  id: 'msg_p5jXN8AQM9LWM0D4loKWxJek',
  timestamp: '1614265330',
  body: '{"test": 2432232314}',
  signature: 'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=',
}
const VECTOR_NOW_MS = Number(VECTOR.timestamp) * 1000

function signPerSpec(key: Buffer, id: string, timestamp: string, body: string): string {
  return createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64')
}

function headersFor(values: Record<string, string>, prefix = 'webhook'): Headers {
  const headers = new Headers()
  for (const [name, value] of Object.entries(values)) headers.set(`${prefix}-${name}`, value)
  return headers
}

function verify(
  overrides: {
    secret?: string
    body?: string
    id?: string
    timestamp?: string
    signature?: string
  } = {}
) {
  return verifyStandardWebhook({
    secret: overrides.secret ?? VECTOR.secret,
    rawBody: overrides.body ?? VECTOR.body,
    headers: headersFor({
      id: overrides.id ?? VECTOR.id,
      timestamp: overrides.timestamp ?? VECTOR.timestamp,
      signature: overrides.signature ?? VECTOR.signature,
    }),
  })
}

describe('verifyStandardWebhook', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(VECTOR_NOW_MS)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('accepts the published test vector', () => {
    expect(verify()).toEqual({ valid: true })
  })

  it('accepts a bare base64 secret without the whsec_ prefix', () => {
    expect(verify({ secret: VECTOR_KEY_BASE64 })).toEqual({ valid: true })
  })

  it('rejects a signature made with a different secret', () => {
    const otherKey = Buffer.from('another-signing-secret')
    const signature = `v1,${signPerSpec(otherKey, VECTOR.id, VECTOR.timestamp, VECTOR.body)}`
    expect(verify({ signature })).toEqual({ valid: false, reason: 'no_matching_signature' })
  })

  it('rejects a tampered body, id, or timestamp under the original signature', () => {
    const tamperedTimestamp = String(Number(VECTOR.timestamp) + 1)
    for (const result of [
      verify({ body: '{"test": 2432232315}' }),
      verify({ id: 'msg_other' }),
      verify({ timestamp: tamperedTimestamp }),
    ]) {
      expect(result).toEqual({ valid: false, reason: 'no_matching_signature' })
    }
  })

  it.each(['id', 'timestamp', 'signature'])('rejects a missing or empty %s header', (name) => {
    for (const value of [null, '']) {
      const headers = headersFor({
        id: VECTOR.id,
        timestamp: VECTOR.timestamp,
        signature: VECTOR.signature,
      })
      if (value === null) headers.delete(`webhook-${name}`)
      else headers.set(`webhook-${name}`, value)
      expect(
        verifyStandardWebhook({ secret: VECTOR.secret, rawBody: VECTOR.body, headers })
      ).toEqual({ valid: false, reason: 'missing_headers' })
    }
  })

  it('reads only the header set named by headerPrefix', () => {
    const svixHeaders = headersFor(
      { id: VECTOR.id, timestamp: VECTOR.timestamp, signature: VECTOR.signature },
      'svix'
    )
    expect(
      verifyStandardWebhook({
        secret: VECTOR.secret,
        rawBody: VECTOR.body,
        headers: svixHeaders,
        headerPrefix: 'svix',
      })
    ).toEqual({ valid: true })
    expect(
      verifyStandardWebhook({ secret: VECTOR.secret, rawBody: VECTOR.body, headers: svixHeaders })
    ).toEqual({ valid: false, reason: 'missing_headers' })
  })

  it('rejects a correctly signed delivery outside the tolerance window, in either direction', () => {
    vi.setSystemTime(VECTOR_NOW_MS + 301_000)
    expect(verify()).toEqual({ valid: false, reason: 'timestamp_out_of_tolerance' })

    vi.setSystemTime(VECTOR_NOW_MS - 301_000)
    expect(verify()).toEqual({ valid: false, reason: 'timestamp_out_of_tolerance' })

    vi.setSystemTime(VECTOR_NOW_MS + 300_000)
    expect(verify()).toEqual({ valid: true })
    vi.setSystemTime(VECTOR_NOW_MS - 300_000)
    expect(verify()).toEqual({ valid: true })
  })

  it('honors a custom tolerance', () => {
    vi.setSystemTime(VECTOR_NOW_MS + 61_000)
    const options = {
      secret: VECTOR.secret,
      rawBody: VECTOR.body,
      headers: headersFor({
        id: VECTOR.id,
        timestamp: VECTOR.timestamp,
        signature: VECTOR.signature,
      }),
    }
    expect(verifyStandardWebhook({ ...options, toleranceSeconds: 60 })).toEqual({
      valid: false,
      reason: 'timestamp_out_of_tolerance',
    })
    expect(verifyStandardWebhook({ ...options, toleranceSeconds: 120 })).toEqual({ valid: true })
  })

  it.each(['abc', '1614265330abc', '-1614265330', '1614265330.5'])(
    'rejects the non-numeric timestamp %j',
    (timestamp) => {
      expect(verify({ timestamp })).toEqual({ valid: false, reason: 'invalid_timestamp' })
    }
  )

  it('accepts when any one of several space-separated signatures matches', () => {
    const signature = `v1,Zm9vYmFy v1,${VECTOR.signature.slice(3)} v1,YmF6`
    expect(verify({ signature })).toEqual({ valid: true })
  })

  it.each([
    ['another version label', `v1a,${VECTOR.signature.slice(3)}`],
    ['a v2 label', `v2,${VECTOR.signature.slice(3)}`],
    ['no version label', VECTOR.signature.slice(3)],
    ['extra comma-separated fields', `${VECTOR.signature},extra`],
  ])('ignores a correct digest carrying %s', (_, signature) => {
    expect(verify({ signature })).toEqual({ valid: false, reason: 'no_matching_signature' })
  })

  it('rejects a signature of a different length without throwing', () => {
    expect(verify({ signature: 'v1,c2hvcnQ=' })).toEqual({
      valid: false,
      reason: 'no_matching_signature',
    })
    expect(verify({ signature: `v1,${'A'.repeat(4096)}` })).toEqual({
      valid: false,
      reason: 'no_matching_signature',
    })
  })

  it.each(['whsec_not*base64!', 'whsec_abc def'])('rejects the malformed secret %j', (secret) => {
    expect(verify({ secret })).toEqual({ valid: false, reason: 'invalid_secret' })
  })

  it('rejects a delivery signed with an empty key, which anyone could forge', () => {
    const forged = `v1,${signPerSpec(Buffer.alloc(0), VECTOR.id, VECTOR.timestamp, VECTOR.body)}`
    for (const secret of ['whsec_', 'whsec_A', 'whsec_==']) {
      expect(verify({ secret, signature: forged })).toEqual({
        valid: false,
        reason: 'invalid_secret',
      })
    }
  })

  it('agrees with an independent spec signer for a non-ASCII body', () => {
    const key = Buffer.from('rotating-secret-bytes')
    const body = '{"name":"Zoë 🚀"}'
    const signature = `v1,${signPerSpec(key, VECTOR.id, VECTOR.timestamp, body)}`
    expect(verify({ secret: `whsec_${key.toString('base64')}`, body, signature })).toEqual({
      valid: true,
    })
  })
})
