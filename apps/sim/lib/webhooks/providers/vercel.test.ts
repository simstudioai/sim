/**
 * @vitest-environment node
 */
import crypto from 'crypto'
import { createMockRequest } from '@sim/testing'
import { describe, expect, it, vi } from 'vitest'
import { vercelHandler } from '@/lib/webhooks/providers/vercel'

vi.mock('@sim/logger', () => ({
  createLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

describe('vercelHandler', () => {
  describe('verifyAuth', () => {
    const secret = 'test-signing-secret'
    const rawBody = JSON.stringify({ type: 'deployment.created', id: 'del_1' })
    const signature = crypto.createHmac('sha1', secret).update(rawBody, 'utf8').digest('hex')

    it('returns 401 when webhookSecret is missing', async () => {
      const request = createMockRequest('POST', JSON.parse(rawBody), {
        'x-vercel-signature': signature,
      })
      const res = await vercelHandler.verifyAuth!({
        request: request as any,
        rawBody,
        requestId: 'r1',
        providerConfig: {},
        webhook: {},
        workflow: {},
      })
      expect(res?.status).toBe(401)
    })

    it('returns 401 when signature header is missing', async () => {
      const request = createMockRequest('POST', JSON.parse(rawBody), {})
      const res = await vercelHandler.verifyAuth!({
        request: request as any,
        rawBody,
        requestId: 'r1',
        providerConfig: { webhookSecret: secret },
        webhook: {},
        workflow: {},
      })
      expect(res?.status).toBe(401)
    })

    it('returns null when signature is valid', async () => {
      const request = createMockRequest('POST', JSON.parse(rawBody), {
        'x-vercel-signature': signature,
      })
      const res = await vercelHandler.verifyAuth!({
        request: request as any,
        rawBody,
        requestId: 'r1',
        providerConfig: { webhookSecret: secret },
        webhook: {},
        workflow: {},
      })
      expect(res).toBeNull()
    })
  })

  describe('extractIdempotencyId', () => {
    it('uses top-level delivery id from Vercel payload', () => {
      expect(vercelHandler.extractIdempotencyId!({ id: 'abc123' })).toBe('vercel:abc123')
      expect(vercelHandler.extractIdempotencyId!({})).toBeNull()
    })
  })
})
