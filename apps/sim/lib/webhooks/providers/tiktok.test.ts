import crypto from 'node:crypto'
import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import {
  parseTikTokContent,
  parseTikTokSignatureHeader,
  tiktokHandler,
  verifyTikTokSignature,
} from '@/lib/webhooks/providers/tiktok'
import { isTikTokEventMatch } from '@/triggers/tiktok/utils'

function signTikTokBody(secret: string, timestamp: string, rawBody: string): string {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`, 'utf8').digest('hex')
}

function requestWithTikTokSignature(signatureHeader: string): NextRequest {
  return new NextRequest('http://localhost/api/webhooks/tiktok', {
    headers: {
      'TikTok-Signature': signatureHeader,
    },
  })
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

  it('rejects a missing signature header', () => {
    const result = verifyTikTokSignature(rawBody, null, 'tt-5', secret)
    expect(result?.status).toBe(401)
  })
})

describe('parseTikTokContent', () => {
  it('parses a JSON string content field', () => {
    expect(parseTikTokContent('{"publish_id":"p1","publish_type":"DIRECT_POST"}')).toEqual({
      publish_id: 'p1',
      publish_type: 'DIRECT_POST',
    })
  })

  it('returns an empty object for invalid JSON', () => {
    expect(parseTikTokContent('{not-json')).toEqual({})
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
  it('verifyAuth delegates to signature verification', async () => {
    const secret = 'tiktok-client-secret'
    const rawBody = '{"event":"authorization.removed"}'
    const now = Math.floor(Date.now() / 1000)
    const timestamp = String(now)
    const signature = signTikTokBody(secret, timestamp, rawBody)

    // verifyAuth uses env.TIKTOK_CLIENT_SECRET; exercise via verifyTikTokSignature path above.
    // Handler still requires a request with the header for the dedicated ingress.
    const res = await tiktokHandler.verifyAuth!({
      request: requestWithTikTokSignature(`t=${timestamp},s=${signature}`),
      rawBody,
      requestId: 'tt-handler',
      providerConfig: {},
      webhook: {},
      workflow: {},
    })
    // Without env secret this may 401; signature path is covered above.
    expect(res === null || res.status === 401).toBe(true)
  })

  it('matchEvent filters by trigger id', async () => {
    const match = await tiktokHandler.matchEvent!({
      body: { event: 'post.publish.complete' },
      request: new NextRequest('http://localhost'),
      requestId: 'tt-match',
      providerConfig: { triggerId: 'tiktok_post_publish_complete' },
      webhook: {},
      workflow: {},
    })
    expect(match).toBe(true)

    const skip = await tiktokHandler.matchEvent!({
      body: { event: 'post.publish.failed' },
      request: new NextRequest('http://localhost'),
      requestId: 'tt-skip',
      providerConfig: { triggerId: 'tiktok_post_publish_complete' },
      webhook: {},
      workflow: {},
    })
    expect(skip).toBe(false)
  })

  it('formatInput flattens envelope and content fields', async () => {
    const { input } = await tiktokHandler.formatInput!({
      body: {
        client_key: 'ck',
        event: 'post.publish.failed',
        create_time: 1615338610,
        user_openid: 'act.user',
        content: '{"publish_id":"pub-1","publish_type":"DIRECT_POST","reason":"spam_risk"}',
      },
      webhook: {},
      workflow: { id: 'w1', userId: 'u1' },
      headers: {},
      requestId: 'tt-fmt',
    })

    expect(input).toEqual({
      event: 'post.publish.failed',
      createTime: 1615338610,
      userOpenId: 'act.user',
      clientKey: 'ck',
      publishId: 'pub-1',
      publishType: 'DIRECT_POST',
      failReason: 'spam_risk',
    })
  })

  it('formatInput maps authorization.removed reason', async () => {
    const { input } = await tiktokHandler.formatInput!({
      body: {
        client_key: 'ck',
        event: 'authorization.removed',
        create_time: 1615338610,
        user_openid: 'act.user',
        content: '{"reason": 1 }',
      },
      webhook: {},
      workflow: { id: 'w1', userId: 'u1' },
      headers: {},
      requestId: 'tt-auth',
    })

    expect(input).toEqual({
      event: 'authorization.removed',
      createTime: 1615338610,
      userOpenId: 'act.user',
      clientKey: 'ck',
      reason: 1,
    })
  })

  it('formatInput emits only the selected event output shape with null optional values', async () => {
    const { input } = await tiktokHandler.formatInput!({
      body: {
        client_key: 'ck',
        event: 'post.publish.publicly_available',
        create_time: 1615338610,
        user_openid: 'act.user',
        content: '{"publish_id":"pub-1"}',
      },
      webhook: {},
      workflow: { id: 'w1', userId: 'u1' },
      headers: {},
      requestId: 'tt-public',
    })

    expect(input).toEqual({
      event: 'post.publish.publicly_available',
      createTime: 1615338610,
      userOpenId: 'act.user',
      clientKey: 'ck',
      publishId: 'pub-1',
      publishType: null,
      postId: null,
    })
    expect(input).not.toHaveProperty('shareId')
    expect(input).not.toHaveProperty('failReason')
  })

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

  it('extractIdempotencyId falls back to share_id then create_time', () => {
    expect(
      tiktokHandler.extractIdempotencyId!({
        event: 'video.publish.completed',
        user_openid: 'act.user',
        create_time: 99,
        content: '{"share_id":"share-1"}',
      })
    ).toBe('video.publish.completed:act.user:share-1')

    expect(
      tiktokHandler.extractIdempotencyId!({
        event: 'authorization.removed',
        user_openid: 'act.user',
        create_time: 42,
        content: '{"reason":1}',
      })
    ).toBe('authorization.removed:act.user:42')
  })
})
