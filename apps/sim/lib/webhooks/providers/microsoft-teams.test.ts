/**
 * @vitest-environment node
 */
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

  it('does not require clientState for non-subscription trigger types', async () => {
    const res = await runVerifyAuth(JSON.stringify({ type: 'message', text: 'hi' }), {})
    expect(res).toBeNull()
  })
})
