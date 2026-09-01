/**
 * @vitest-environment node
 */
import crypto from 'crypto'
import { createMockRequest } from '@sim/testing'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ashbyHandler } from '@/lib/webhooks/providers/ashby'
import type {
  AuthContext,
  EventMatchContext,
  FormatInputContext,
} from '@/lib/webhooks/providers/types'

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

function formatInputContext(body: unknown): FormatInputContext {
  return {
    webhook: { id: 'w1' },
    workflow: { id: 'workflow-1', userId: 'user-1' },
    body,
    headers: {},
    query: {},
    method: 'POST',
    requestId: 'r1',
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

    it('returns 401 when signature header is missing', () => {
      const request = createMockRequest('POST', JSON.parse(rawBody), {})
      const res = ashbyHandler.verifyAuth!(authContext(request, rawBody, { secretToken: secret }))
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

    it('matches when action equals the configured trigger event', async () => {
      const matched = await ashbyHandler.matchEvent!(
        eventMatchContext({ action: 'applicationSubmit', data: {} }, 'ashby_application_submit')
      )
      expect(matched).toBe(true)
    })

    it('rejects when action does not match the configured trigger event', async () => {
      const matched = await ashbyHandler.matchEvent!(
        eventMatchContext({ action: 'jobCreate', data: {} }, 'ashby_application_submit')
      )
      expect(matched).toBe(false)
    })

    it('matches newly supported Ashby events', async () => {
      const matched = await ashbyHandler.matchEvent!(
        eventMatchContext(
          { action: 'signatureRequestUpdate', data: {} },
          'ashby_signature_request_update'
        )
      )
      expect(matched).toBe(true)
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

  describe('formatInput', () => {
    it('spreads data fields to the top level alongside action', async () => {
      const result = await ashbyHandler.formatInput!(
        formatInputContext({
          action: 'applicationSubmit',
          webhookActionId: 'action-1',
          data: { application: { id: 'app-1', status: 'Active' } },
        })
      )
      expect(result.input).toEqual({
        action: 'applicationSubmit',
        webhookActionId: 'action-1',
        application: { id: 'app-1', status: 'Active' },
      })
    })

    it('renames currentInterviewStage.type to stageType, matching the trigger output schema', async () => {
      const result = await ashbyHandler.formatInput!(
        formatInputContext({
          action: 'candidateStageChange',
          data: {
            application: {
              id: 'app-1',
              currentInterviewStage: { id: 'stage-1', title: 'Offer', type: 'Offer' },
            },
          },
        })
      )
      expect(result.input.application).toEqual({
        id: 'app-1',
        currentInterviewStage: { id: 'stage-1', title: 'Offer', stageType: 'Offer' },
      })
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

    it('surfaces the plain-string errors array Ashby also returns', async () => {
      respondWith({ success: false, errors: ['webhook_not_found'] })
      await expect(ashbyHandler.createSubscription?.(ctx)).rejects.toThrow(/webhook_not_found/)
    })

    it('still prefers errorInfo.message when Ashby sends both shapes at once', async () => {
      respondWith({
        success: false,
        errors: ['webhook_not_found'],
        errorInfo: { code: 'webhook_not_found', message: 'Webhook not found' },
      })
      await expect(ashbyHandler.createSubscription?.(ctx)).rejects.toThrow(/Webhook not found/)
    })

    it('keeps the actionable duplicate-webhook guidance reachable', async () => {
      // The duplicate branch only fires when the message was extracted, so an
      // unparsed error costs the user the instructions for fixing it.
      respondWith({ success: false, errors: [{ message: 'duplicate webhook for this url' }] })
      await expect(ashbyHandler.createSubscription?.(ctx)).rejects.toThrow(
        /Ashby Settings > API\/Webhooks/
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

    it('stays non-fatal for a failed delete when not strict', async () => {
      respondWith({ success: false, errors: [{ message: 'missing_endpoint_permission' }] })
      await expect(ashbyHandler.deleteSubscription?.(ctx(false))).resolves.toBeUndefined()
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

    it('recognizes a not-found reported only as prose', async () => {
      respondWith({ success: false, errorInfo: { message: 'Webhook not found' } })
      await expect(ashbyHandler.deleteSubscription?.(ctx(true))).resolves.toBeUndefined()
    })

    it('accepts a successful delete', async () => {
      respondWith({ success: true, results: { webhookId: 'ext-1' } })
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

    it('derives a key from candidate id for candidateDelete', () => {
      const body = { action: 'candidateDelete', data: { candidate: { id: 'cand-1' } } }
      expect(ashbyHandler.extractIdempotencyId!(body)).toBe('ashby:candidateDelete:cand-1')
    })

    it('derives a key from job id for jobCreate', () => {
      const body = { action: 'jobCreate', data: { job: { id: 'job-1' } } }
      expect(ashbyHandler.extractIdempotencyId!(body)).toBe('ashby:jobCreate:job-1')
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

    it('distinguishes candidateHire deliveries sharing application id + updatedAt but differing in offer', () => {
      const application = { id: 'app-1', status: 'Hired', updatedAt: '2026-01-01T00:00:00Z' }
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
      // a genuine retry of `first` (identical offer too) still dedupes
      expect(ashbyHandler.extractIdempotencyId!({ ...first })).toBe(
        ashbyHandler.extractIdempotencyId!(first)
      )
    })

    it('returns null when no recognizable resource is present', () => {
      expect(ashbyHandler.extractIdempotencyId!({ action: 'ping', data: {} })).toBeNull()
      expect(ashbyHandler.extractIdempotencyId!({})).toBeNull()
    })
  })
})
