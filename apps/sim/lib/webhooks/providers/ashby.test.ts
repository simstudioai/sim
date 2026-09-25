import crypto from 'crypto'
import { createMockRequest } from '@sim/testing'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ashbyHandler } from '@/lib/webhooks/providers/ashby'
import type { AuthContext, EventMatchContext } from '@/lib/webhooks/providers/types'

function authContext(
  request: AuthContext['request'],
  rawBody: string,
  providerConfig: Record<string, unknown>
): AuthContext {
  return {
    request,
    rawBody,
    requestId: 'r1',
    providerConfig,
    webhook: {},
    workflow: {},
  }
}

function eventMatchContext(body: unknown, triggerId: string): EventMatchContext {
  return {
    webhook: { id: 'w1' },
    workflow: {},
    body,
    request: createMockRequest('POST', body),
    requestId: 'r1',
    providerConfig: { triggerId },
  }
}

describe('ashbyHandler', () => {
  describe('verifyAuth', () => {
    const secret = 'test-secret-token'
    const rawBody = JSON.stringify({ action: 'ping', data: { webhookActionType: 'ping' } })
    const signature = `sha256=${crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')}`

    it('returns 401 when secretToken is missing', () => {
      const request = createMockRequest('POST', JSON.parse(rawBody), {
        'ashby-signature': signature,
      })
      const res = ashbyHandler.verifyAuth!(authContext(request, rawBody, {}))
      expect(res?.status).toBe(401)
    })

    it('returns 401 when signature is invalid', () => {
      const request = createMockRequest('POST', JSON.parse(rawBody), {
        'ashby-signature': 'sha256=deadbeef',
      })
      const res = ashbyHandler.verifyAuth!(authContext(request, rawBody, { secretToken: secret }))
      expect(res?.status).toBe(401)
    })

    it('returns null when signature is valid', () => {
      const request = createMockRequest('POST', JSON.parse(rawBody), {
        'ashby-signature': signature,
      })
      const res = ashbyHandler.verifyAuth!(authContext(request, rawBody, { secretToken: secret }))
      expect(res).toBeNull()
    })
  })

  describe('matchEvent', () => {
    it('rejects ping events', async () => {
      const matched = await ashbyHandler.matchEvent!(
        eventMatchContext(
          { action: 'ping', data: { webhookActionType: 'ping' } },
          'ashby_application_submit'
        )
      )
      expect(matched).toBe(false)
    })

    it('rejects when action does not match the configured trigger event', async () => {
      const matched = await ashbyHandler.matchEvent!(
        eventMatchContext({ action: 'jobCreate', data: {} }, 'ashby_application_submit')
      )
      expect(matched).toBe(false)
    })
  })

  describe('extractIdempotencyId', () => {
    it('uses Ashby webhookActionId across retries and related event deliveries', () => {
      expect(
        ashbyHandler.extractIdempotencyId!({
          action: 'applicationUpdate',
          webhookActionId: 'action-1',
          data: { application: { id: 'app-1' } },
        })
      ).toBe('ashby:webhook-action:action-1')
    })
  })

  describe('createSubscription error reporting', () => {
    const realFetch = globalThis.fetch
    afterEach(() => {
      globalThis.fetch = realFetch
    })

    const ctx = {
      requestId: 'req-1',
      webhook: {
        id: 'wh-1',
        path: '/api/webhooks/trigger/abc',
        providerConfig: { apiKey: 'k', triggerId: 'ashby_job_create' },
      },
    } as never

    const respondWith = (body: unknown, status = 200) => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        })
      ) as never
    }

    it('surfaces the object-shaped errors array Ashby documents', async () => {
      // Reading only errorInfo.message misses this form, which is what a
      // missing-permission failure arrives in - the user would see
      // 'Unknown Ashby API error' instead of the actual cause.
      respondWith({ success: false, errors: [{ message: 'missing_endpoint_permission' }] })
      await expect(ashbyHandler.createSubscription?.(ctx)).rejects.toThrow(
        /missing_endpoint_permission/
      )
    })
  })

  describe('deleteSubscription', () => {
    const realFetch = globalThis.fetch
    afterEach(() => {
      globalThis.fetch = realFetch
    })

    const ctx = (strict: boolean) =>
      ({
        requestId: 'req-1',
        strict,
        webhook: {
          id: 'wh-1',
          providerConfig: { apiKey: 'k', externalId: 'ext-1' },
        },
      }) as never

    const respondWith = (body: unknown, status = 200) => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        })
      ) as never
    }

    it('treats a 200 carrying success:false as a failed delete', async () => {
      // Ashby returns what would be a 4XX as HTTP 200. Branching on
      // response.ok alone reported the leak as a successful cleanup.
      respondWith({ success: false, errors: [{ message: 'missing_endpoint_permission' }] })
      await expect(ashbyHandler.deleteSubscription?.(ctx(true))).rejects.toThrow(
        /missing_endpoint_permission/
      )
    })

    it('treats an already-removed webhook as done even in strict mode', async () => {
      respondWith({ success: false, errors: ['webhook_not_found'] })
      await expect(ashbyHandler.deleteSubscription?.(ctx(true))).resolves.toBeUndefined()
    })

    it('recognizes the not-found envelope Ashby actually sends for a repeat delete', async () => {
      // errorInfo.message wins over the code array in the extractor, so it reads
      // 'Webhook not found' - matching that against `webhook_not_found` would
      // turn idempotent cleanup into a strict-mode throw.
      respondWith({
        success: false,
        errors: ['webhook_not_found'],
        errorInfo: {
          code: 'webhook_not_found',
          message: 'Webhook not found',
          requestId: '01JSJ8FEK5ZN4XQBZP7DBKK7ZC',
        },
      })
      await expect(ashbyHandler.deleteSubscription?.(ctx(true))).resolves.toBeUndefined()
    })

    it('rejects an oversized provider response before buffering it', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response('{}', {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'content-length': String(Number.MAX_SAFE_INTEGER),
          },
        })
      ) as never
      await expect(ashbyHandler.deleteSubscription?.(ctx(true))).rejects.toThrow(
        /exceeds maximum size/
      )
    })
  })

  describe('extractIdempotencyId', () => {
    it('derives a stable key from application id + updatedAt', () => {
      const body = {
        action: 'candidateStageChange',
        data: { application: { id: 'app-1', updatedAt: '2026-01-01T00:00:00Z' } },
      }
      expect(ashbyHandler.extractIdempotencyId!(body)).toBe(
        'ashby:candidateStageChange:app-1:2026-01-01T00:00:00Z'
      )
      expect(ashbyHandler.extractIdempotencyId!({ ...body })).toBe(
        ashbyHandler.extractIdempotencyId!(body)
      )
    })

    it('derives a stable key from offer id alone, ignoring mutable decidedAt', () => {
      const created = { action: 'offerCreate', data: { offer: { id: 'offer-1', decidedAt: null } } }
      expect(ashbyHandler.extractIdempotencyId!(created)).toBe('ashby:offerCreate:offer-1')

      const retriedAfterDecision = {
        action: 'offerCreate',
        data: { offer: { id: 'offer-1', decidedAt: '2026-01-02T00:00:00Z' } },
      }
      expect(ashbyHandler.extractIdempotencyId!(retriedAfterDecision)).toBe(
        ashbyHandler.extractIdempotencyId!(created)
      )
    })

    it('falls back to a content fingerprint when updatedAt is missing, still deduping retries', () => {
      const body = {
        action: 'candidateStageChange',
        data: { application: { id: 'app-1', status: 'Active' } },
      }
      const key = ashbyHandler.extractIdempotencyId!(body)
      expect(key).not.toBeNull()
      expect(ashbyHandler.extractIdempotencyId!({ ...body, data: { ...body.data } })).toBe(key)

      const different = {
        action: 'candidateStageChange',
        data: { application: { id: 'app-1', status: 'Hired' } },
      }
      expect(ashbyHandler.extractIdempotencyId!(different)).not.toBe(key)
    })

    it('distinguishes candidateHire deliveries that share an application snapshot but differ in offer', () => {
      const application = { id: 'app-1', status: 'Hired' }
      const first = {
        action: 'candidateHire',
        data: { application, offer: { id: 'offer-1' } },
      }
      const second = {
        action: 'candidateHire',
        data: { application, offer: { id: 'offer-2' } },
      }
      expect(ashbyHandler.extractIdempotencyId!(first)).not.toBe(
        ashbyHandler.extractIdempotencyId!(second)
      )
    })
  })
})
