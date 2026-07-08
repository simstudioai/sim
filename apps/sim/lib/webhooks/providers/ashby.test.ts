/**
 * @vitest-environment node
 */
import crypto from 'crypto'
import { createMockRequest } from '@sim/testing'
import { describe, expect, it } from 'vitest'
import { ashbyHandler } from '@/lib/webhooks/providers/ashby'

describe('ashbyHandler', () => {
  describe('verifyAuth', () => {
    const secret = 'test-secret-token'
    const rawBody = JSON.stringify({ action: 'ping', data: { webhookActionType: 'ping' } })
    const signature = `sha256=${crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')}`

    it('returns 401 when secretToken is missing', () => {
      const request = createMockRequest('POST', JSON.parse(rawBody), {
        'ashby-signature': signature,
      })
      const res = ashbyHandler.verifyAuth!({
        request: request as any,
        rawBody,
        requestId: 'r1',
        providerConfig: {},
        webhook: {},
        workflow: {},
      })
      expect(res?.status).toBe(401)
    })

    it('returns 401 when signature header is missing', () => {
      const request = createMockRequest('POST', JSON.parse(rawBody), {})
      const res = ashbyHandler.verifyAuth!({
        request: request as any,
        rawBody,
        requestId: 'r1',
        providerConfig: { secretToken: secret },
        webhook: {},
        workflow: {},
      })
      expect(res?.status).toBe(401)
    })

    it('returns 401 when signature is invalid', () => {
      const request = createMockRequest('POST', JSON.parse(rawBody), {
        'ashby-signature': 'sha256=deadbeef',
      })
      const res = ashbyHandler.verifyAuth!({
        request: request as any,
        rawBody,
        requestId: 'r1',
        providerConfig: { secretToken: secret },
        webhook: {},
        workflow: {},
      })
      expect(res?.status).toBe(401)
    })

    it('returns null when signature is valid', () => {
      const request = createMockRequest('POST', JSON.parse(rawBody), {
        'ashby-signature': signature,
      })
      const res = ashbyHandler.verifyAuth!({
        request: request as any,
        rawBody,
        requestId: 'r1',
        providerConfig: { secretToken: secret },
        webhook: {},
        workflow: {},
      })
      expect(res).toBeNull()
    })
  })

  describe('matchEvent', () => {
    it('rejects ping events', async () => {
      const matched = await ashbyHandler.matchEvent!({
        webhook: { id: 'w1' } as any,
        body: { action: 'ping', data: { webhookActionType: 'ping' } },
        requestId: 'r1',
        providerConfig: { triggerId: 'ashby_application_submit' },
      } as any)
      expect(matched).toBe(false)
    })

    it('matches when action equals the configured trigger event', async () => {
      const matched = await ashbyHandler.matchEvent!({
        webhook: { id: 'w1' } as any,
        body: { action: 'applicationSubmit', data: {} },
        requestId: 'r1',
        providerConfig: { triggerId: 'ashby_application_submit' },
      } as any)
      expect(matched).toBe(true)
    })

    it('rejects when action does not match the configured trigger event', async () => {
      const matched = await ashbyHandler.matchEvent!({
        webhook: { id: 'w1' } as any,
        body: { action: 'jobCreate', data: {} },
        requestId: 'r1',
        providerConfig: { triggerId: 'ashby_application_submit' },
      } as any)
      expect(matched).toBe(false)
    })
  })

  describe('formatInput', () => {
    it('spreads data fields to the top level alongside action', async () => {
      const result = await ashbyHandler.formatInput!({
        body: {
          action: 'applicationSubmit',
          data: { application: { id: 'app-1', status: 'Active' } },
        },
      } as any)
      expect(result.input).toEqual({
        action: 'applicationSubmit',
        application: { id: 'app-1', status: 'Active' },
      })
    })

    it('renames currentInterviewStage.type to stageType, matching the trigger output schema', async () => {
      const result = await ashbyHandler.formatInput!({
        body: {
          action: 'candidateStageChange',
          data: {
            application: {
              id: 'app-1',
              currentInterviewStage: { id: 'stage-1', title: 'Offer', type: 'Offer' },
            },
          },
        },
      } as any)
      expect(result.input.application).toEqual({
        id: 'app-1',
        currentInterviewStage: { id: 'stage-1', title: 'Offer', stageType: 'Offer' },
      })
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
