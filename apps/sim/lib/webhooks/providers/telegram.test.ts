import { requestUtilsMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { telegramHandler } from '@/lib/webhooks/providers/telegram'

function reqWithHeaders(headers: Record<string, string>): NextRequest {
  return new NextRequest('http://localhost/test', { headers })
}

describe('Telegram webhook provider', () => {
  beforeEach(() => {
    requestUtilsMockFns.mockGetClientIp.mockReturnValue('203.0.113.7')
  })

  it('verifyAuth rejects an unconfigured webhook when the source IP is not Telegram', () => {
    const res = telegramHandler.verifyAuth!({
      request: reqWithHeaders({ 'x-telegram-bot-api-secret-token': 'anything' }),
      rawBody: '{}',
      requestId: 't1',
      providerConfig: {},
      webhook: {},
      workflow: {},
    })
    expect((res as { status?: number })?.status).toBe(401)
  })

  it('verifyAuth accepts a legacy webhook (no secret) from a Telegram source IP', () => {
    requestUtilsMockFns.mockGetClientIp.mockReturnValue('149.154.167.197')
    const res = telegramHandler.verifyAuth!({
      request: reqWithHeaders({}),
      rawBody: '{}',
      requestId: 't1b',
      providerConfig: {},
      webhook: {},
      workflow: {},
    })
    expect(res).toBeNull()
  })

  it('verifyAuth rejects a legacy webhook (no secret) when the source IP is unknown', () => {
    requestUtilsMockFns.mockGetClientIp.mockReturnValue('unknown')
    const res = telegramHandler.verifyAuth!({
      request: reqWithHeaders({}),
      rawBody: '{}',
      requestId: 't1c',
      providerConfig: {},
      webhook: {},
      workflow: {},
    })
    expect((res as { status?: number })?.status).toBe(401)
  })

  it('verifyAuth rejects when the secret token header is missing', () => {
    const res = telegramHandler.verifyAuth!({
      request: reqWithHeaders({}),
      rawBody: '{}',
      requestId: 't2',
      providerConfig: { secretToken: 'super-secret' },
      webhook: {},
      workflow: {},
    })
    expect((res as { status?: number })?.status).toBe(401)
  })

  it('verifyAuth rejects when the secret token does not match', () => {
    const res = telegramHandler.verifyAuth!({
      request: reqWithHeaders({ 'x-telegram-bot-api-secret-token': 'wrong' }),
      rawBody: '{}',
      requestId: 't3',
      providerConfig: { secretToken: 'super-secret' },
      webhook: {},
      workflow: {},
    })
    expect((res as { status?: number })?.status).toBe(401)
  })

  it('verifyAuth accepts a matching secret token', () => {
    const res = telegramHandler.verifyAuth!({
      request: reqWithHeaders({ 'x-telegram-bot-api-secret-token': 'super-secret' }),
      rawBody: '{}',
      requestId: 't4',
      providerConfig: { secretToken: 'super-secret' },
      webhook: {},
      workflow: {},
    })
    expect(res).toBeNull()
  })

  it('extractIdempotencyId keys on update_id', () => {
    expect(telegramHandler.extractIdempotencyId!({ update_id: 42 })).toBe('telegram:42')
    expect(telegramHandler.extractIdempotencyId!({})).toBeNull()
  })
})
