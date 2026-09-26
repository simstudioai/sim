import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  parseTikTokSignatureHeader,
  tiktokHandler,
  verifyTikTokSignature,
} from '@/lib/webhooks/providers/tiktok'
import { isTikTokEventMatch } from '@/triggers/tiktok/utils'

function signTikTokBody(secret: string, timestamp: string, rawBody: string): string {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`, 'utf8').digest('hex')
}

describe('parseTikTokSignatureHeader', () => {
  it('parses t and s from the header', () => {
    expect(
      parseTikTokSignatureHeader(
        't=1633174587,s=18494715036ac4416a1d0a673871a2edbcfc94d94bd88ccd2c5ec9b3425afe66'
      )
    ).toEqual({
      timestamp: '1633174587',
      signature: '18494715036ac4416a1d0a673871a2edbcfc94d94bd88ccd2c5ec9b3425afe66',
    })
  })

  it('returns null for missing or malformed headers', () => {
    expect(parseTikTokSignatureHeader(null)).toBeNull()
    expect(parseTikTokSignatureHeader('')).toBeNull()
    expect(parseTikTokSignatureHeader('t=123')).toBeNull()
    expect(parseTikTokSignatureHeader('s=abc')).toBeNull()
  })
})

describe('verifyTikTokSignature', () => {
  const secret = 'tiktok-client-secret'
  const rawBody = JSON.stringify({
    client_key: 'key',
    event: 'post.publish.complete',
    create_time: 1615338610,
    user_openid: 'act.example',
    content: '{"publish_id":"p1","publish_type":"DIRECT_POST"}',
  })

  it('accepts a valid signature within the skew window', () => {
    const now = Math.floor(Date.now() / 1000)
    const timestamp = String(now)
    const signature = signTikTokBody(secret, timestamp, rawBody)
    const result = verifyTikTokSignature(
      rawBody,
      `t=${timestamp},s=${signature}`,
      'tt-1',
      secret,
      now
    )
    expect(result).toBeNull()
  })

  it('rejects an invalid signature', () => {
    const now = Math.floor(Date.now() / 1000)
    const result = verifyTikTokSignature(
      rawBody,
      `t=${now},s=${'0'.repeat(64)}`,
      'tt-2',
      secret,
      now
    )
    expect(result?.status).toBe(401)
  })

  it('rejects when the client secret is missing', () => {
    const now = Math.floor(Date.now() / 1000)
    const result = verifyTikTokSignature(rawBody, `t=${now},s=abc`, 'tt-3', undefined, now)
    expect(result?.status).toBe(401)
  })

  it('rejects a stale timestamp', () => {
    const now = Math.floor(Date.now() / 1000)
    const stale = String(now - 600)
    const signature = signTikTokBody(secret, stale, rawBody)
    const result = verifyTikTokSignature(rawBody, `t=${stale},s=${signature}`, 'tt-4', secret, now)
    expect(result?.status).toBe(401)
  })
})

describe('isTikTokEventMatch', () => {
  it('matches documented event names including TikTok typo', () => {
    expect(isTikTokEventMatch('tiktok_post_publish_complete', 'post.publish.complete')).toBe(true)
    expect(
      isTikTokEventMatch(
        'tiktok_post_no_longer_public',
        'post.publish.no_longer_publicaly_available'
      )
    ).toBe(true)
    expect(isTikTokEventMatch('tiktok_post_publish_complete', 'post.publish.failed')).toBe(false)
  })
})

describe('tiktokHandler', () => {
  it('distinguishes multiple completed posts created from one publish_id', () => {
    expect(
      tiktokHandler.extractIdempotencyId!({
        event: 'post.publish.complete',
        user_openid: 'act.user',
        create_time: 1,
        content: '{"publish_id":"pub-1"}',
      })
    ).toBe('post.publish.complete:act.user:pub-1:1')

    expect(
      tiktokHandler.extractIdempotencyId!({
        event: 'post.publish.complete',
        user_openid: 'act.user',
        create_time: 2,
        content: '{"publish_id":"pub-1"}',
      })
    ).toBe('post.publish.complete:act.user:pub-1:2')
  })

  it('uses post_id to distinguish public availability events for the same publish_id', () => {
    expect(
      tiktokHandler.extractIdempotencyId!({
        event: 'post.publish.publicly_available',
        user_openid: 'act.user',
        create_time: 3,
        content: '{"publish_id":"pub-1","post_id":"post-1"}',
      })
    ).toBe('post.publish.publicly_available:act.user:pub-1:post-1')
  })
})
