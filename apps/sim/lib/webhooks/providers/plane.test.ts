import { createHmac } from 'node:crypto'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import { describe, expect, it } from 'vitest'
import { planeHandler } from '@/lib/webhooks/providers/plane'
import type { AuthContext, EventMatchContext } from '@/lib/webhooks/providers/types'

const SECRET = 'plane_wh_test-fixture'
const V1 = {
  event: 'issue',
  action: 'updated',
  webhook_id: 'webhook-a',
  workspace_id: 'workspace-a',
  workspace_slug: 'example',
  data: { id: 'item-a', project: 'project-a', name: 'Example' },
  activity: { field: 'name', old_value: 'Before', new_value: 'Example' },
}
const V2 = {
  version: 'v2',
  event: 'workitem.deleted',
  event_id: 'event-a',
  delivery_id: 'delivery-a',
  entity_id: 'item-a',
  entity_type: 'issue',
  webhook_id: 'webhook-a',
  workspace_id: 'workspace-a',
  data: {},
  previous_attributes: { id: 'item-a', project_id: 'project-a' },
}

function authContext(rawBody: string, signature?: string, secret?: string): AuthContext {
  return {
    webhook: {},
    workflow: {},
    rawBody,
    requestId: 'test',
    providerConfig: secret === undefined ? {} : { webhookSecret: secret },
    request: createMockRequest({
      url: 'https://example.com/webhook',
      method: 'POST',
      headers: signature ? { 'X-Plane-Signature': signature } : {},
      rawBody,
    }),
  }
}

function matchContext(body: unknown, providerConfig: Record<string, unknown>): EventMatchContext {
  return { ...authContext(JSON.stringify(body)), body, providerConfig }
}

describe('Plane signed webhook delivery', () => {
  it('verifies raw bytes and rejects altered JSON even when it parses to the same object', async () => {
    const raw = JSON.stringify(V1)
    const signature = createHmac('sha256', SECRET).update(raw).digest('hex')
    if (!planeHandler.verifyAuth) throw new Error('Plane authentication is missing')
    expect(await planeHandler.verifyAuth(authContext(raw, signature, SECRET))).toBeNull()
    expect(
      (await planeHandler.verifyAuth(authContext(`${raw}\n`, signature, SECRET)))?.status
    ).toBe(401)
  })

  it.each([
    [undefined, SECRET],
    ['invalid-signature', SECRET],
    ['valid-looking-signature', undefined],
  ])('fails closed for absent or invalid authentication', async (signature, secret) => {
    if (!planeHandler.verifyAuth) throw new Error('Plane authentication is missing')
    expect(
      (await planeHandler.verifyAuth(authContext(JSON.stringify(V1), signature, secret)))?.status
    ).toBe(401)
  })

  it.each(['webhook-a', 'untracked-webhook'])(
    'accepts the tracked previous secret only for its subscription: %s',
    async (webhookId) => {
      const raw = JSON.stringify({ ...V2, webhook_id: webhookId })
      const signature = createHmac('sha256', SECRET).update(raw).digest('hex')
      const ctx = authContext(raw, signature, 'replacement-secret')
      ctx.providerConfig.previousSubscription = {
        provider: 'plane',
        providerConfig: { externalId: 'webhook-a', webhookSecret: SECRET },
      }
      if (!planeHandler.verifyAuth) throw new Error('Plane authentication is missing')
      const response = await planeHandler.verifyAuth(ctx)
      expect(response?.status ?? 200).toBe(webhookId === 'webhook-a' ? 200 : 401)
    }
  )

  it('keeps the previous event scope until replacement activation succeeds', async () => {
    if (!planeHandler.matchEvent) throw new Error('Plane event filtering is missing')
    const config = {
      triggerId: 'plane_workitem_created',
      projectId: 'project-b',
      subscriptionActivationPending: true,
      previousSubscription: {
        provider: 'plane',
        providerConfig: {
          externalId: 'webhook-a',
          triggerId: 'plane_workitem_updated',
          projectId: 'project-a',
        },
      },
    }
    expect(await planeHandler.matchEvent(matchContext(V1, config))).toBe(true)
    expect(
      await planeHandler.matchEvent(
        matchContext(V1, { ...config, subscriptionActivationPending: false })
      )
    ).toBe(false)
    expect(
      await planeHandler.matchEvent(matchContext({ ...V1, webhook_id: 'replacement' }, config))
    ).toBe(false)
  })

  it('deduplicates v2 retries by event ID while separating distinct events', () => {
    if (!planeHandler.extractIdempotencyId) throw new Error('Plane deduplication is missing')
    const original = planeHandler.extractIdempotencyId(V2)
    expect(original).toBeTruthy()
    expect(planeHandler.extractIdempotencyId({ ...V2, delivery_id: 'retry-b' })).toBe(original)
    expect(planeHandler.extractIdempotencyId({ ...V2, event_id: 'event-b' })).not.toBe(original)
  })

  it('deduplicates v1 retries without collapsing different changes to one work item', () => {
    if (!planeHandler.extractIdempotencyId) throw new Error('Plane deduplication is missing')
    const original = planeHandler.extractIdempotencyId(V1)
    expect(original).toBeTruthy()
    expect(planeHandler.extractIdempotencyId(structuredClone(V1))).toBe(original)
    expect(
      planeHandler.extractIdempotencyId({
        ...V1,
        activity: { field: 'priority', new_value: 'high' },
      })
    ).not.toBe(original)
  })

  it('filters both v1 and v2 deliveries by event and canonical project/workspace scope', async () => {
    if (!planeHandler.matchEvent) throw new Error('Plane event filtering is missing')
    expect(
      await planeHandler.matchEvent(
        matchContext(V1, {
          triggerId: 'plane_workitem_updated',
          projectId: 'project-a',
          workspaceId: 'workspace-a',
        })
      )
    ).toBe(true)
    expect(
      await planeHandler.matchEvent(matchContext(V1, { triggerId: 'plane_workitem_created' }))
    ).toBe(false)
    expect(
      await planeHandler.matchEvent(
        matchContext(V1, { triggerId: 'plane_webhook', workspaceId: 'workspace-b' })
      )
    ).toBe(false)
    expect(
      await planeHandler.matchEvent(
        matchContext(V2, { triggerId: 'plane_workitem_deleted', projectId: 'project-a' })
      )
    ).toBe(true)
    expect(
      await planeHandler.matchEvent(
        matchContext(V2, { triggerId: 'plane_workitem_deleted', projectId: 'project-b' })
      )
    ).toBe(false)
    expect(
      await planeHandler.matchEvent(
        matchContext(
          { ...V1, event: 'project', action: 'created', data: { id: 'project-a' } },
          { triggerId: 'plane_project_created', projectId: 'project-a' }
        )
      )
    ).toBe(true)
    expect(
      await planeHandler.matchEvent(
        matchContext(
          {
            ...V2,
            event: 'project.deleted',
            entity_id: 'project-a',
            previous_attributes: { id: 'project-a' },
          },
          { triggerId: 'plane_project_deleted', projectId: 'project-a' }
        )
      )
    ).toBe(true)
  })
})
