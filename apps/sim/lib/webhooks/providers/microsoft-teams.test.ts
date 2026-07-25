/**
 * @vitest-environment node
 */
import { hmacSha256Base64 } from '@sim/security/hmac'
import { authOAuthUtilsMock, inputValidationMock } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)
vi.mock('@/app/api/auth/oauth/utils', () => authOAuthUtilsMock)

import { microsoftTeamsHandler } from '@/lib/webhooks/providers/microsoft-teams'

const WEBHOOK_ID = 'webhook-uuid-1234'

function makeRequest(body: string): NextRequest {
  return new NextRequest('https://app.example.com/api/webhooks/trigger/abc', {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/json' },
  })
}

function makeNotificationBody(clientState?: unknown): string {
  return JSON.stringify({
    value: [
      {
        subscriptionId: 'sub-1',
        changeType: 'created',
        resource: 'chats/19:abc@thread.v2/messages/1700000000000',
        resourceData: { id: '1700000000000' },
        ...(clientState !== undefined ? { clientState } : {}),
      },
    ],
  })
}

async function runVerifyAuth(rawBody: string, providerConfig: Record<string, unknown>) {
  return microsoftTeamsHandler.verifyAuth!({
    webhook: { id: WEBHOOK_ID },
    workflow: {},
    request: makeRequest(rawBody),
    rawBody,
    requestId: 'test-req',
    providerConfig,
  })
}

describe('microsoftTeamsHandler verifyAuth (chat subscription clientState)', () => {
  const chatSubscriptionConfig = { triggerId: 'microsoftteams_chat_subscription' }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('accepts notifications whose clientState matches the webhook id', async () => {
    const res = await runVerifyAuth(makeNotificationBody(WEBHOOK_ID), chatSubscriptionConfig)
    expect(res).toBeNull()
  })

  it('rejects notifications with a forged clientState', async () => {
    const res = await runVerifyAuth(makeNotificationBody('forged'), chatSubscriptionConfig)
    expect(res?.status).toBe(401)
  })

  it('rejects notifications missing clientState', async () => {
    const res = await runVerifyAuth(makeNotificationBody(), chatSubscriptionConfig)
    expect(res?.status).toBe(401)
  })

  it('rejects non-string clientState values', async () => {
    const res = await runVerifyAuth(
      makeNotificationBody({ nested: WEBHOOK_ID }),
      chatSubscriptionConfig
    )
    expect(res?.status).toBe(401)
  })

  it('rejects payloads without a value array', async () => {
    const res = await runVerifyAuth(JSON.stringify({ hello: 'world' }), chatSubscriptionConfig)
    expect(res?.status).toBe(401)
  })

  it('rejects payloads with an empty value array', async () => {
    const res = await runVerifyAuth(JSON.stringify({ value: [] }), chatSubscriptionConfig)
    expect(res?.status).toBe(401)
  })

  it('rejects unparseable bodies', async () => {
    const res = await runVerifyAuth('not-json', chatSubscriptionConfig)
    expect(res?.status).toBe(401)
  })

  it('rejects batches where any notification has a mismatched clientState', async () => {
    const rawBody = JSON.stringify({
      value: [
        { subscriptionId: 'sub-1', resourceData: { id: '1' }, clientState: WEBHOOK_ID },
        { subscriptionId: 'sub-2', resourceData: { id: '2' }, clientState: 'forged' },
      ],
    })
    const res = await runVerifyAuth(rawBody, chatSubscriptionConfig)
    expect(res?.status).toBe(401)
  })

  it('fails closed when the webhook record has no id', async () => {
    const res = await microsoftTeamsHandler.verifyAuth!({
      webhook: {},
      workflow: {},
      request: makeRequest(makeNotificationBody('')),
      rawBody: makeNotificationBody(''),
      requestId: 'test-req',
      providerConfig: chatSubscriptionConfig,
    })
    expect(res?.status).toBe(401)
  })
})

describe('microsoftTeamsHandler verifyAuth (outgoing webhook HMAC)', () => {
  const secretBase64 = Buffer.from('super-secret').toString('base64')
  const outgoingWebhookConfig = { triggerId: 'microsoftteams_webhook', hmacSecret: secretBase64 }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  function signedRequest(rawBody: string): NextRequest {
    const signature = hmacSha256Base64(rawBody, Buffer.from(secretBase64, 'base64'))
    return new NextRequest('https://app.example.com/api/webhooks/trigger/abc', {
      method: 'POST',
      body: rawBody,
      headers: { 'Content-Type': 'application/json', Authorization: `HMAC ${signature}` },
    })
  }

  it('accepts a request with a valid HMAC signature', async () => {
    const rawBody = JSON.stringify({ type: 'message', text: 'hi' })
    const res = await microsoftTeamsHandler.verifyAuth!({
      webhook: { id: WEBHOOK_ID },
      workflow: {},
      request: signedRequest(rawBody),
      rawBody,
      requestId: 'test-req',
      providerConfig: outgoingWebhookConfig,
    })
    expect(res).toBeNull()
  })

  it('rejects a request with an invalid HMAC signature', async () => {
    const rawBody = JSON.stringify({ type: 'message', text: 'hi' })
    const res = await microsoftTeamsHandler.verifyAuth!({
      webhook: { id: WEBHOOK_ID },
      workflow: {},
      request: makeRequest(rawBody),
      rawBody,
      requestId: 'test-req',
      providerConfig: { ...outgoingWebhookConfig, hmacSecret: undefined },
    })
    expect(res?.status).toBe(401)
  })

  it('fails closed when no HMAC secret is configured for an outgoing webhook trigger', async () => {
    const rawBody = JSON.stringify({ type: 'message', text: 'hi' })
    const res = await runVerifyAuth(rawBody, { triggerId: 'microsoftteams_webhook' })
    expect(res?.status).toBe(401)
  })
})

describe('microsoftTeamsHandler extractIdempotencyId', () => {
  it('derives a key from subscriptionId + messageId for Graph change notifications', () => {
    const body = JSON.parse(makeNotificationBody(WEBHOOK_ID)) as unknown
    expect(microsoftTeamsHandler.extractIdempotencyId!(body)).toBe(`sub-1:1700000000000`)
  })

  it('derives a key from the Activity id for outgoing webhook messages', () => {
    const body = { id: 'activity-123', type: 'message', text: 'hi' }
    expect(microsoftTeamsHandler.extractIdempotencyId!(body)).toBe('activity-123')
  })

  it('returns null when neither shape yields a stable identifier', () => {
    expect(microsoftTeamsHandler.extractIdempotencyId!({ type: 'message' })).toBeNull()
  })

  it('returns null instead of throwing when body is null', () => {
    expect(microsoftTeamsHandler.extractIdempotencyId!(null)).toBeNull()
  })

  it('returns null instead of throwing when body is a primitive', () => {
    expect(microsoftTeamsHandler.extractIdempotencyId!('not-an-object')).toBeNull()
  })
})

describe('microsoftTeamsHandler formatInput (outgoing webhook channelData)', () => {
  it('populates teamsTeamId/teamsChannelId from nested team/channel ids', async () => {
    const body = {
      id: 'activity-123',
      type: 'message',
      text: 'hello',
      channelData: {
        team: { id: 'team-1' },
        channel: { id: 'channel-1' },
        tenant: { id: 'tenant-1' },
      },
    }
    const result = await microsoftTeamsHandler.formatInput!({
      body,
      webhook: {},
      workflow: { id: 'wf-1', userId: 'user-1' },
      headers: {},
      requestId: 'test-req',
    })
    const input = result.input as {
      message: { raw: { channelData: Record<string, unknown> } }
    }
    expect(input.message.raw.channelData).toEqual({
      team: { id: 'team-1' },
      tenant: { id: 'tenant-1' },
      channel: { id: 'channel-1' },
      teamsTeamId: 'team-1',
      teamsChannelId: 'channel-1',
    })
  })
})
