/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/oauth/credential-service', () => ({
  refreshAccessTokenIfNeeded: vi.fn(),
}))

vi.mock('@/lib/webhooks/provider-subscription-utils', () => ({
  getCredentialOwner: vi.fn(),
  getNotificationUrl: vi.fn(() => 'https://example.com/api/webhooks/trigger/path'),
}))

import { refreshAccessTokenIfNeeded } from '@/lib/oauth/credential-service'
import {
  matchesPendingWebhookVerificationProbe,
  requiresPendingWebhookVerification,
} from '@/lib/webhooks/pending-verification'
import { getCredentialOwner } from '@/lib/webhooks/provider-subscription-utils'
import { mapZohoWebhookError, zohoDeskHandler } from '@/lib/webhooks/providers/zoho-desk'

function errorStatus(err: unknown): number | undefined {
  return (err as { status?: number })?.status
}

function makeAuthContext(headers: Record<string, string>, providerConfig: Record<string, unknown>) {
  return {
    webhook: {},
    workflow: {},
    request: { headers: new Headers(headers) } as unknown as Request,
    rawBody: '',
    requestId: 'test',
    providerConfig,
  }
}

describe('zohoDeskHandler', () => {
  it('acknowledges ingress via the durable queue (5s deadline)', () => {
    expect(zohoDeskHandler.executionMode).toBe('queue')
  })

  describe('verifyAuth', () => {
    afterEach(() => {
      vi.mocked(getCredentialOwner).mockReset()
    })

    it('rejects requests without the X-ZDesk-JWT header', async () => {
      const result = await zohoDeskHandler.verifyAuth?.(
        makeAuthContext({}, { orgId: '1', webhookId: '2' }) as any
      )
      expect(result).not.toBeNull()
      expect(result?.status).toBe(401)
    })

    it('falls back to the credential Desk domain when the webhook row has no apiDomain', async () => {
      vi.mocked(getCredentialOwner).mockResolvedValue({
        accountId: 'acct-1',
        userId: 'u1',
      } as any)
      await zohoDeskHandler.verifyAuth?.(
        makeAuthContext(
          { 'x-zdesk-jwt': 'not-a-real-jwt' },
          { orgId: '1', externalId: '2', credentialId: 'cred-1' }
        ) as any
      )
      expect(getCredentialOwner).toHaveBeenCalledWith('cred-1', 'test')
    })

    it('uses the persisted apiDomain without a credential lookup (fast path)', async () => {
      await zohoDeskHandler.verifyAuth?.(
        makeAuthContext(
          { 'x-zdesk-jwt': 'not-a-real-jwt' },
          { orgId: '1', externalId: '2', credentialId: 'cred-1', apiDomain: 'https://desk.zoho.eu' }
        ) as any
      )
      expect(getCredentialOwner).not.toHaveBeenCalled()
    })
  })

  describe('createSubscription', () => {
    async function captureCreateError(providerConfig: Record<string, unknown>): Promise<unknown> {
      try {
        await zohoDeskHandler.createSubscription?.({
          webhook: { providerConfig },
          workflow: {},
          userId: 'user-1',
          requestId: 'test',
          request: {} as any,
        })
      } catch (error) {
        return error
      }
      return undefined
    }

    it('fails terminally (400) when the organization ID is missing', async () => {
      const error = await captureCreateError({ eventType: 'Ticket_Add' })
      expect((error as Error)?.message).toMatch(/Organization ID/i)
      expect(errorStatus(error)).toBe(400)
    })

    it('fails terminally (400) when the event type is missing', async () => {
      const error = await captureCreateError({ orgId: '700123' })
      expect((error as Error)?.message).toMatch(/event type/i)
      expect(errorStatus(error)).toBe(400)
    })

    it('accepts the manual organization field when the canonical orgId is absent', async () => {
      // Reaching the event-type guard proves the organization guard passed, i.e.
      // `manualOrgId` resolved. See resolveConfigOrgId: the deploy-time canonical
      // collapse normally writes `orgId`, but drops it when the pair is pinned to
      // basic mode while only the manual field carries a value.
      const error = await captureCreateError({ manualOrgId: '700123' })
      expect((error as Error)?.message).toMatch(/event type/i)
      expect(errorStatus(error)).toBe(400)
    })

    it('prefers the collapsed canonical orgId over the manual field', async () => {
      const error = await captureCreateError({ orgId: '', manualOrgId: '   ' })
      expect((error as Error)?.message).toMatch(/Organization ID/i)
      expect(errorStatus(error)).toBe(400)
    })
  })

  describe('formatInput', () => {
    it('maps a Zoho Desk event array to the trigger outputs', async () => {
      const result = await zohoDeskHandler.formatInput?.({
        webhook: {},
        workflow: { id: 'wf', userId: 'user' },
        body: [
          {
            eventType: 'Ticket_Add',
            eventTime: '1700000000000',
            orgId: '700123',
            payload: { id: 'ticket-1' },
            prevState: null,
          },
        ],
        headers: {},
        requestId: 'test',
      })
      expect(result?.input).toMatchObject({
        eventType: 'Ticket_Add',
        eventTime: '1700000000000',
        orgId: '700123',
        payload: { id: 'ticket-1' },
      })
    })

    it('passes through a non-array body unchanged', async () => {
      const body = { unexpected: true }
      const result = await zohoDeskHandler.formatInput?.({
        webhook: {},
        workflow: { id: 'wf', userId: 'user' },
        body,
        headers: {},
        requestId: 'test',
      })
      expect(result?.input).toBe(body)
    })

    it('emits a normalized null shape for an empty array instead of leaking []', async () => {
      const result = await zohoDeskHandler.formatInput?.({
        webhook: {},
        workflow: { id: 'wf', userId: 'user' },
        body: [],
        headers: {},
        requestId: 'test',
      })
      expect(result?.input).toEqual({
        eventType: null,
        eventTime: null,
        orgId: null,
        payload: null,
        prevState: null,
      })
    })

    it('derives a plain-text contentText for html comment/thread payloads', async () => {
      const result = await zohoDeskHandler.formatInput?.({
        webhook: {},
        workflow: { id: 'wf', userId: 'user' },
        body: [
          {
            eventType: 'Ticket_Comment_Add',
            eventTime: '1700000000000',
            orgId: '700123',
            payload: {
              id: 'comment-1',
              content: '<div style="direction: ltr;"><div>testing</div></div>',
              contentType: 'html',
            },
            prevState: { id: 'comment-1', content: '<div>before</div>', contentType: 'html' },
          },
        ],
        headers: {},
        requestId: 'test',
      })
      const input = result?.input as {
        payload: Record<string, unknown>
        prevState: Record<string, unknown>
      }
      expect(input.payload.content).toBe('<div style="direction: ltr;"><div>testing</div></div>')
      expect(input.payload.contentType).toBe('html')
      expect(input.payload.contentText).toBe('testing')
      // prevState is enriched symmetrically so before/after comparisons match shapes.
      expect(input.prevState.content).toBe('<div>before</div>')
      expect(input.prevState.contentText).toBe('before')
    })

    it('mirrors plainText content into contentText', async () => {
      const result = await zohoDeskHandler.formatInput?.({
        webhook: {},
        workflow: { id: 'wf', userId: 'user' },
        body: [
          {
            eventType: 'Ticket_Comment_Add',
            eventTime: '1700000000000',
            orgId: '700123',
            payload: { id: 'comment-2', content: 'just text', contentType: 'plainText' },
            prevState: null,
          },
        ],
        headers: {},
        requestId: 'test',
      })
      const payload = (result?.input as { payload: Record<string, unknown> }).payload
      expect(payload.contentText).toBe('just text')
      expect(payload.content).toBe('just text')
    })
  })

  describe('createSubscription request body', () => {
    afterEach(() => {
      vi.restoreAllMocks()
      vi.mocked(getCredentialOwner).mockReset()
      vi.mocked(refreshAccessTokenIfNeeded).mockReset()
    })

    it('omits ignoreSourceId (Zoho rejects an arbitrary UUID) and returns no such id', async () => {
      vi.mocked(getCredentialOwner).mockResolvedValue({
        accountId: 'acc-1',
        userId: 'user-1',
      } as any)
      vi.mocked(refreshAccessTokenIfNeeded).mockResolvedValue('zoho-token')

      let sentBody: Record<string, unknown> = {}
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
        sentBody = JSON.parse(String((init as RequestInit).body))
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ id: 'wh-123' }),
        } as unknown as Response
      })

      const result = await zohoDeskHandler.createSubscription?.({
        webhook: {
          id: 'w1',
          path: 'p1',
          providerConfig: { credentialId: 'cred-1', orgId: '700123', eventType: 'Ticket_Add' },
        },
        workflow: {},
        userId: 'user-1',
        requestId: 'test',
        request: {} as any,
      })

      expect(sentBody).not.toHaveProperty('ignoreSourceId')
      expect(sentBody.subscriptions).toHaveProperty('Ticket_Add')
      expect(sentBody.isEnabled).toBe(true)
      expect(result?.providerConfigUpdates).toMatchObject({ externalId: 'wh-123' })
      expect(result?.providerConfigUpdates).not.toHaveProperty('ignoreSourceId')
    })

    /** Drives createSubscription and returns the JSON body sent to Zoho. */
    async function captureSentBody(
      providerConfig: Record<string, unknown>
    ): Promise<Record<string, unknown>> {
      vi.mocked(getCredentialOwner).mockResolvedValue({
        accountId: 'acc-1',
        userId: 'user-1',
      } as any)
      vi.mocked(refreshAccessTokenIfNeeded).mockResolvedValue('zoho-token')

      let sentBody: Record<string, unknown> = {}
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
        sentBody = JSON.parse(String((init as RequestInit).body))
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ id: 'wh-123' }),
        } as unknown as Response
      })

      await zohoDeskHandler.createSubscription?.({
        webhook: {
          id: 'w1',
          path: 'p1',
          providerConfig: { credentialId: 'cred-1', orgId: '700123', ...providerConfig },
        },
        workflow: {},
        userId: 'user-1',
        requestId: 'test',
        request: {} as any,
      })
      return sentBody
    }

    // Zoho documents includePrevState on the Ticket/Contact/Agent/Task/Article
    // update events but NOT on Ticket_Comment_Update, which lists only
    // departmentIds. An `endsWith('_Update')` rule sent an undocumented filter
    // key on that one event.
    it.each(['Ticket_Update', 'Contact_Update', 'Agent_Update', 'Task_Update', 'Article_Update'])(
      'sets includePrevState for %s',
      async (eventType) => {
        const body = await captureSentBody({ eventType })
        expect((body.subscriptions as Record<string, unknown>)[eventType]).toMatchObject({
          includePrevState: true,
        })
      }
    )

    it('does NOT set includePrevState for Ticket_Comment_Update', async () => {
      // With a department filter the object exists, so this proves the key is
      // absent rather than the whole filter being null for an unrelated reason.
      const withDepts = await captureSentBody({
        eventType: 'Ticket_Comment_Update',
        triggerDepartmentIds: '111',
      })
      expect((withDepts.subscriptions as Record<string, unknown>).Ticket_Comment_Update).toEqual({
        departmentIds: ['111'],
      })

      // And with no filters at all it collapses to null, not `{includePrevState:true}`.
      const bare = await captureSentBody({ eventType: 'Ticket_Comment_Update' })
      expect((bare.subscriptions as Record<string, unknown>).Ticket_Comment_Update).toBeNull()
    })

    // Zoho: events outside the ticket/task family "do not support filters.
    // Therefore, pass the value as null in the API request."
    it('drops departmentIds for an event whose filter does not accept it', async () => {
      const body = await captureSentBody({
        eventType: 'Contact_Add',
        triggerDepartmentIds: '111,222',
      })
      expect((body.subscriptions as Record<string, unknown>).Contact_Add).toBeNull()
    })

    it('keeps departmentIds for an event whose filter accepts it', async () => {
      const body = await captureSentBody({
        eventType: 'Ticket_Add',
        triggerDepartmentIds: '111,222',
      })
      expect((body.subscriptions as Record<string, unknown>).Ticket_Add).toEqual({
        departmentIds: ['111', '222'],
      })
    })

    it('sends null, not an empty object, when an event has no filters', async () => {
      const body = await captureSentBody({ eventType: 'Ticket_Delete' })
      expect((body.subscriptions as Record<string, unknown>).Ticket_Delete).toBeNull()
    })
  })

  describe('mapZohoWebhookError', () => {
    it('surfaces INVALID_DATA field errors and is non-retryable (4xx)', () => {
      const err = mapZohoWebhookError(
        422,
        JSON.stringify({
          errorCode: 'INVALID_DATA',
          errors: [
            {
              fieldName: '/ignoreSourceId',
              errorMessage:
                "The value passed for field '/ignoreSourceId' does not match the allowed values.",
            },
          ],
        })
      )
      expect(err.message).toContain('INVALID_DATA')
      expect(err.message).toContain('/ignoreSourceId')
      expect(err.message).not.toContain('Professional edition')
      expect(errorStatus(err)).toBe(422)
    })

    it('surfaces UNPROCESSABLE_ENTITY (URL validation) verbatim, non-retryable', () => {
      const err = mapZohoWebhookError(
        422,
        JSON.stringify({
          errorCode: 'UNPROCESSABLE_ENTITY',
          message:
            'Validation failed for the condition : The endpoint failed to respond with status code 200',
        })
      )
      expect(err.message).toContain('endpoint failed to respond with status code 200')
      expect(err.message).not.toContain('Professional edition')
      expect(errorStatus(err)).toBe(422)
    })

    it('only claims the edition/permission cause when Zoho indicates it', () => {
      const err = mapZohoWebhookError(
        403,
        JSON.stringify({ errorCode: 'PERMISSION_DENIED', message: 'You do not have permission' })
      )
      expect(err.message).toContain('permission')
      expect(err.message).toContain('Professional edition')
      expect(errorStatus(err)).toBe(403)
    })

    it('does not add the edition hint to a 403 whose body is unrelated to edition/permission', () => {
      const err = mapZohoWebhookError(
        403,
        JSON.stringify({ errorCode: 'INVALID_OAUTH', message: 'Invalid OAuth token' })
      )
      expect(err.message).toContain('INVALID_OAUTH')
      expect(err.message).toContain('Invalid OAuth token')
      expect(err.message).not.toContain('Professional edition')
      expect(errorStatus(err)).toBe(403)
    })

    it('keeps provider 5xx retryable', () => {
      const err = mapZohoWebhookError(500, JSON.stringify({ errorCode: 'INTERNAL_ERROR' }))
      expect(errorStatus(err)).toBe(503)
    })
  })

  describe('create-time URL verification probe', () => {
    it('opts Zoho Desk into pending webhook verification', () => {
      expect(requiresPendingWebhookVerification('zoho_desk')).toBe(true)
    })

    it('answers Zoho GET/HEAD probes but not real POST deliveries', () => {
      const entry = { provider: 'zoho_desk', path: 'p1', expiresAt: Date.now() + 60_000 }
      expect(
        matchesPendingWebhookVerificationProbe(entry, { method: 'GET', body: undefined })
      ).toBe(true)
      expect(
        matchesPendingWebhookVerificationProbe(entry, { method: 'HEAD', body: undefined })
      ).toBe(true)
      expect(
        matchesPendingWebhookVerificationProbe(entry, { method: 'POST', body: { eventType: 'x' } })
      ).toBe(false)
    })
  })
})
