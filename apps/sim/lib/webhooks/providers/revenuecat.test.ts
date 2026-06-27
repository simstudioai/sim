import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { revenueCatHandler } from '@/lib/webhooks/providers/revenuecat'

function requestWithAuth(authValue?: string): NextRequest {
  return new NextRequest('http://localhost/test', {
    headers: authValue ? { authorization: authValue } : {},
  })
}

const sampleInitialPurchase = {
  api_version: '1.0',
  event: {
    type: 'INITIAL_PURCHASE',
    id: '12345678-1234-1234-1234-123456789012',
    app_id: '1234567890',
    event_timestamp_ms: 1658726378679,
    app_user_id: '1234567890',
    original_app_user_id: '$RCAnonymousID:abc',
    aliases: ['$RCAnonymousID:abc'],
    product_id: 'com.subscription.weekly',
    period_type: 'NORMAL',
    purchased_at_ms: 1658726374000,
    expiration_at_ms: 1659331174000,
    environment: 'PRODUCTION',
    entitlement_id: null,
    entitlement_ids: ['pro'],
    presented_offering_id: null,
    transaction_id: '123456789012345',
    original_transaction_id: '123456789012345',
    is_family_share: false,
    country_code: 'US',
    currency: 'USD',
    price: 4.99,
    price_in_purchased_currency: 4.99,
    store: 'APP_STORE',
    takehome_percentage: 0.7,
    tax_percentage: 0.0,
    commission_percentage: 0.3,
    offer_code: null,
    subscriber_attributes: { $email: { updated_at_ms: 1662955084635, value: 'a@b.com' } },
    experiments: [],
  },
}

describe('RevenueCat webhook provider', () => {
  describe('verifyAuth', () => {
    const secret = 'super-secret-header-value'

    it('allows requests when no secret is configured', async () => {
      const res = await revenueCatHandler.verifyAuth!({
        request: requestWithAuth(),
        rawBody: '{}',
        requestId: 'rc-1',
        providerConfig: {},
        webhook: {},
        workflow: {},
      })
      expect(res).toBeNull()
    })

    it('rejects requests missing the Authorization header', async () => {
      const res = await revenueCatHandler.verifyAuth!({
        request: requestWithAuth(),
        rawBody: '{}',
        requestId: 'rc-2',
        providerConfig: { authHeaderSecret: secret },
        webhook: {},
        workflow: {},
      })
      expect(res?.status).toBe(401)
    })

    it('rejects requests with a mismatched Authorization header', async () => {
      const res = await revenueCatHandler.verifyAuth!({
        request: requestWithAuth('wrong-value'),
        rawBody: '{}',
        requestId: 'rc-3',
        providerConfig: { authHeaderSecret: secret },
        webhook: {},
        workflow: {},
      })
      expect(res?.status).toBe(401)
    })

    it('accepts requests with a matching Authorization header', async () => {
      const res = await revenueCatHandler.verifyAuth!({
        request: requestWithAuth(secret),
        rawBody: '{}',
        requestId: 'rc-4',
        providerConfig: { authHeaderSecret: secret },
        webhook: {},
        workflow: {},
      })
      expect(res).toBeNull()
    })
  })

  describe('matchEvent', () => {
    it('matches the configured event type', async () => {
      const res = await revenueCatHandler.matchEvent!({
        body: sampleInitialPurchase,
        request: requestWithAuth(),
        requestId: 'rc-5',
        providerConfig: { triggerId: 'revenuecat_initial_purchase' },
        webhook: {},
        workflow: {},
      })
      expect(res).toBe(true)
    })

    it('skips events whose type does not match the trigger', async () => {
      const res = await revenueCatHandler.matchEvent!({
        body: sampleInitialPurchase,
        request: requestWithAuth(),
        requestId: 'rc-6',
        providerConfig: { triggerId: 'revenuecat_cancellation' },
        webhook: {},
        workflow: {},
      })
      expect(res).toBe(false)
    })
  })

  describe('formatInput', () => {
    it('flattens the event wrapper into the trigger output keys', async () => {
      const { input } = await revenueCatHandler.formatInput!({
        body: sampleInitialPurchase,
        webhook: {},
        workflow: { id: 'wf', userId: 'user' },
        headers: {},
        requestId: 'rc-7',
      })
      const data = input as Record<string, unknown>
      expect(data.type).toBe('INITIAL_PURCHASE')
      expect(data.app_user_id).toBe('1234567890')
      expect(data.product_id).toBe('com.subscription.weekly')
      expect(data.price).toBe(4.99)
      expect(data.entitlement_ids).toEqual(['pro'])
      expect(data.cancel_reason).toBeNull()
      expect(data.new_product_id).toBeNull()
      expect(data.api_version).toBe('1.0')
      expect(data.event).toEqual(sampleInitialPurchase.event)
    })
  })

  describe('createSubscription', () => {
    const baseCtx = {
      webhook: {
        id: 'wh-1',
        path: 'abc123',
        providerConfig: {
          apiKey: 'sk_test',
          projectId: 'proj1ab2c3d4',
          triggerId: 'revenuecat_initial_purchase',
          environment: 'all',
        },
      },
      workflow: {},
      userId: 'user-1',
      requestId: 'rc-create',
      request: requestWithAuth(),
    }

    beforeEach(() => {
      vi.restoreAllMocks()
      vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://sim.example.com')
    })

    afterEach(() => {
      vi.restoreAllMocks()
      vi.unstubAllEnvs()
    })

    it('creates the integration and returns externalId + generated authHeaderSecret', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ id: 'wh_remote_1' }), { status: 201 }))
      vi.stubGlobal('fetch', fetchMock)

      const result = await revenueCatHandler.createSubscription!(baseCtx)

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('https://api.revenuecat.com/v2/projects/proj1ab2c3d4/integrations/webhooks')
      expect(init.method).toBe('POST')
      expect(init.headers.Authorization).toBe('Bearer sk_test')
      const body = JSON.parse(init.body)
      expect(body.event_types).toEqual(['initial_purchase'])
      expect(body.url).toContain('/api/webhooks/trigger/abc123')
      expect(typeof body.authorization_header).toBe('string')
      expect(body.authorization_header.length).toBeGreaterThan(0)
      expect(body.environment).toBeUndefined()

      expect(result?.providerConfigUpdates?.externalId).toBe('wh_remote_1')
      expect(result?.providerConfigUpdates?.authHeaderSecret).toBe(body.authorization_header)
    })

    it('forwards a concrete environment when set to production', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ id: 'wh_remote_2' }), { status: 201 }))
      vi.stubGlobal('fetch', fetchMock)

      await revenueCatHandler.createSubscription!({
        ...baseCtx,
        webhook: {
          ...baseCtx.webhook,
          providerConfig: { ...baseCtx.webhook.providerConfig, environment: 'production' },
        },
      })

      const body = JSON.parse(fetchMock.mock.calls[0][1].body)
      expect(body.environment).toBe('production')
    })

    it('throws when the API key is missing', async () => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)
      await expect(
        revenueCatHandler.createSubscription!({
          ...baseCtx,
          webhook: { ...baseCtx.webhook, providerConfig: { projectId: 'proj1ab2c3d4' } },
        })
      ).rejects.toThrow(/Secret API key/)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('throws a friendly error on a 401 from RevenueCat', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })))
      await expect(revenueCatHandler.createSubscription!(baseCtx)).rejects.toThrow(
        /authentication failed/i
      )
    })
  })

  describe('deleteSubscription', () => {
    const baseCtx = {
      webhook: {
        id: 'wh-1',
        providerConfig: { apiKey: 'sk_test', projectId: 'proj1ab2c3d4', externalId: 'wh_remote_1' },
      },
      workflow: {},
      requestId: 'rc-delete',
    }

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('issues a DELETE to the integration endpoint', async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
      vi.stubGlobal('fetch', fetchMock)

      await revenueCatHandler.deleteSubscription!(baseCtx)

      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe(
        'https://api.revenuecat.com/v2/projects/proj1ab2c3d4/integrations/webhooks/wh_remote_1'
      )
      expect(init.method).toBe('DELETE')
      expect(init.headers.Authorization).toBe('Bearer sk_test')
    })

    it('does not throw on a 404 (already gone)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 404 })))
      await expect(revenueCatHandler.deleteSubscription!(baseCtx)).resolves.toBeUndefined()
    })

    it('skips silently when credentials are missing (non-strict)', async () => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)
      await expect(
        revenueCatHandler.deleteSubscription!({
          ...baseCtx,
          webhook: { id: 'wh-1', providerConfig: {} },
        })
      ).resolves.toBeUndefined()
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('throws on missing credentials when strict', async () => {
      vi.stubGlobal('fetch', vi.fn())
      await expect(
        revenueCatHandler.deleteSubscription!({
          ...baseCtx,
          webhook: { id: 'wh-1', providerConfig: {} },
          strict: true,
        })
      ).rejects.toThrow(/Missing RevenueCat credentials/)
    })
  })

  describe('extractIdempotencyId', () => {
    it('returns the event id', () => {
      expect(revenueCatHandler.extractIdempotencyId!(sampleInitialPurchase)).toBe(
        '12345678-1234-1234-1234-123456789012'
      )
    })

    it('returns null when no event id is present', () => {
      expect(revenueCatHandler.extractIdempotencyId!({ event: {} })).toBeNull()
    })
  })
})
