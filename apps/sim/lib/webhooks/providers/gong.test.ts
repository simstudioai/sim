import { createHash } from 'node:crypto'
import * as jose from 'jose'
import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import {
  GONG_JWT_PUBLIC_KEY_CONFIG_KEY,
  gongHandler,
  normalizeGongPublicKeyPem,
  verifyGongJwtAuth,
} from '@/lib/webhooks/providers/gong'

describe('normalizeGongPublicKeyPem', () => {
  it('passes through PEM', () => {
    const pem = '-----BEGIN PUBLIC KEY-----\nabc\n-----END PUBLIC KEY-----'
    expect(normalizeGongPublicKeyPem(pem)).toBe(pem)
  })

  it('wraps raw base64', () => {
    const raw = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAxfj3'
    const out = normalizeGongPublicKeyPem(raw)
    expect(out).toContain('BEGIN PUBLIC KEY')
    expect(out).toContain('END PUBLIC KEY')
    expect(out).toContain('MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAxfj3')
  })

  it('returns null for garbage', () => {
    expect(normalizeGongPublicKeyPem('not-base64!!!')).toBeNull()
  })
})

describe('gongHandler formatInput', () => {
  it('always returns callId as a string', async () => {
    const { input } = await gongHandler.formatInput!({
      webhook: {},
      workflow: { id: 'wf', userId: 'u' },
      body: { callData: { metaData: {} } },
      headers: {},
      requestId: 'gong-format',
    })

    expect((input as Record<string, unknown>).callId).toBe('')
  })

  it('exposes content topics and highlights alongside trackers', async () => {
    const { input } = await gongHandler.formatInput!({
      webhook: {},
      workflow: { id: 'wf', userId: 'u' },
      body: {
        callData: {
          metaData: { id: '99' },
          content: {
            trackers: [{ id: 't1', name: 'Competitor', count: 2 }],
            topics: [{ name: 'Pricing', duration: 120 }],
            highlights: [{ title: 'Action items' }],
          },
        },
      },
      headers: {},
      requestId: 'gong-format-content',
    })
    const rec = input as Record<string, unknown>
    expect(rec.callId).toBe('99')
    expect(rec.trackers).toEqual([{ id: 't1', name: 'Competitor', count: 2 }])
    expect(rec.topics).toEqual([{ name: 'Pricing', duration: 120 }])
    expect(rec.highlights).toEqual([{ title: 'Action items' }])
  })
})

describe('gongHandler verifyAuth (JWT)', () => {
  it('returns null when JWT public key is not configured', async () => {
    const request = new NextRequest('https://app.example.com/api/webhooks/trigger/abc', {
      method: 'POST',
      body: '{}',
    })
    const rawBody = '{}'
    const res = await verifyGongJwtAuth({
      webhook: {},
      workflow: {},
      request,
      rawBody,
      requestId: 't1',
      providerConfig: {},
    })
    expect(res).toBeNull()
  })

  it('returns 401 when key is configured but Authorization is missing', async () => {
    const { publicKey } = await jose.generateKeyPair('RS256')
    const spki = await jose.exportSPKI(publicKey)
    const request = new NextRequest('https://app.example.com/api/webhooks/trigger/abc', {
      method: 'POST',
      body: '{}',
    })
    const res = await verifyGongJwtAuth({
      webhook: {},
      workflow: {},
      request,
      rawBody: '{}',
      requestId: 't2',
      providerConfig: { [GONG_JWT_PUBLIC_KEY_CONFIG_KEY]: spki },
    })
    expect(res?.status).toBe(401)
  })

  it('accepts a valid Gong-style JWT', async () => {
    const { publicKey, privateKey } = await jose.generateKeyPair('RS256')
    const spki = await jose.exportSPKI(publicKey)
    const url = 'https://app.example.com/api/webhooks/trigger/test-path'
    const rawBody = '{"callData":{}}'
    const bodySha = createHash('sha256').update(rawBody, 'utf8').digest('hex')

    const jwt = await new jose.SignJWT({
      webhook_url: url,
      body_sha256: bodySha,
    })
      .setProtectedHeader({ alg: 'RS256' })
      .setExpirationTime('1h')
      .sign(privateKey)

    const request = new NextRequest(url, {
      method: 'POST',
      body: rawBody,
      headers: { Authorization: `Bearer ${jwt}` },
    })

    const res = await gongHandler.verifyAuth!({
      webhook: {},
      workflow: {},
      request,
      rawBody,
      requestId: 't3',
      providerConfig: { [GONG_JWT_PUBLIC_KEY_CONFIG_KEY]: spki },
    })
    expect(res).toBeNull()
  })

  it('rejects JWT when body hash does not match', async () => {
    const { publicKey, privateKey } = await jose.generateKeyPair('RS256')
    const spki = await jose.exportSPKI(publicKey)
    const url = 'https://app.example.com/api/webhooks/trigger/x'
    const rawBody = '{"a":1}'

    const jwt = await new jose.SignJWT({
      webhook_url: url,
      body_sha256: 'deadbeef',
    })
      .setProtectedHeader({ alg: 'RS256' })
      .setExpirationTime('1h')
      .sign(privateKey)

    const request = new NextRequest(url, {
      method: 'POST',
      body: rawBody,
      headers: { Authorization: jwt },
    })

    const res = await verifyGongJwtAuth({
      webhook: {},
      workflow: {},
      request,
      rawBody,
      requestId: 't4',
      providerConfig: { [GONG_JWT_PUBLIC_KEY_CONFIG_KEY]: spki },
    })
    expect(res?.status).toBe(401)
  })
})
