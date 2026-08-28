/**
 * @vitest-environment node
 */
import { NextRequest, NextResponse } from 'next/server'
import { describe, expect, it, vi } from 'vitest'

const { mockDispatchResolvedWebhookTarget } = vi.hoisted(() => ({
  mockDispatchResolvedWebhookTarget: vi.fn(),
}))

vi.mock('@/lib/webhooks/processor', () => ({
  dispatchResolvedWebhookTarget: mockDispatchResolvedWebhookTarget,
}))

vi.mock('@/lib/webhooks/providers/slack', () => ({
  resolveSlackEventKey: vi.fn(),
}))

import { dispatchResolvedWebhookTarget } from '@/lib/webhooks/processor'
import {
  dispatchSlackWebhooks,
  getSlackDispatchFailureResponse,
  getSlackDispatchResponse,
  resolveSlackExternalUserSubject,
} from '@/lib/webhooks/slack-dispatch'

describe('resolveSlackExternalUserSubject', () => {
  it('resolves an Events API user with the provider tenant', () => {
    expect(
      resolveSlackExternalUserSubject({
        team_id: 'T_WORKSPACE',
        event: { type: 'app_mention', user: 'U_PERSON' },
      })
    ).toEqual({
      kind: 'external_user',
      provider: 'slack',
      tenantId: 'T_WORKSPACE',
      subjectId: 'U_PERSON',
    })
  })

  it('uses the actor tenant for Slack Connect interactions', () => {
    expect(
      resolveSlackExternalUserSubject({
        type: 'block_actions',
        team: { id: 'T_INSTALLATION' },
        user: { id: 'U_EXTERNAL', team_id: 'T_EXTERNAL' },
      })
    ).toEqual({
      kind: 'external_user',
      provider: 'slack',
      tenantId: 'T_EXTERNAL',
      subjectId: 'U_EXTERNAL',
    })
  })

  it('does not create a human subject for bot events', () => {
    expect(
      resolveSlackExternalUserSubject({
        team_id: 'T_WORKSPACE',
        event: { type: 'message', user: 'U_BOT', bot_id: 'B_BOT', subtype: 'bot_message' },
      })
    ).toBeUndefined()
  })

  it('fails closed when either stable provider identifier is missing', () => {
    expect(resolveSlackExternalUserSubject({ event: { user: 'U_PERSON' } })).toBeUndefined()
    expect(resolveSlackExternalUserSubject({ team_id: 'T_WORKSPACE', event: {} })).toBeUndefined()
  })
})

describe('dispatchSlackWebhooks', () => {
  it('dispatches at most ten targets concurrently and preserves result order', async () => {
    let active = 0
    let peak = 0
    const releases: Array<() => void> = []

    vi.mocked(dispatchResolvedWebhookTarget).mockImplementation(async (foundWebhook) => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise<void>((resolve) => releases.push(resolve))
      active -= 1

      const index = Number(foundWebhook.id.replace('webhook-', ''))
      return {
        outcome: 'queued',
        response: new NextResponse(null, { status: 200 + index }),
        reason: 'queued',
      }
    })

    const webhooks = Array.from({ length: 12 }, (_, index) => ({
      webhook: { id: `webhook-${index}`, providerConfig: {} },
      workflow: { id: `workflow-${index}` },
    }))
    const dispatchPromise = dispatchSlackWebhooks(webhooks as never, {
      body: { event: { type: 'message' } },
      request: new NextRequest('http://localhost/api/webhooks/slack'),
      requestId: 'request-1',
      receivedAt: Date.now(),
    })

    await vi.waitFor(() => expect(mockDispatchResolvedWebhookTarget).toHaveBeenCalledTimes(10))
    expect(active).toBe(10)

    for (let index = 0; index < 10; index += 1) {
      releases.shift()?.()
    }

    await vi.waitFor(() => expect(mockDispatchResolvedWebhookTarget).toHaveBeenCalledTimes(12))
    while (releases.length > 0) {
      releases.shift()?.()
    }

    const results = await dispatchPromise
    expect(peak).toBe(10)
    expect(results.map(({ response }) => response.status)).toEqual(
      Array.from({ length: 12 }, (_, index) => 200 + index)
    )
  })

  it('returns the failure when no Slack target is acknowledged', () => {
    const response = getSlackDispatchResponse([
      {
        outcome: 'failed',
        response: new NextResponse(null, { status: 500 }),
        reason: 'queue-failed',
      },
    ])

    expect(response.status).toBe(500)
  })

  it('acknowledges a mixed fan-out when at least one Slack target queues', () => {
    const response = getSlackDispatchResponse([
      {
        outcome: 'failed',
        response: new NextResponse(null, { status: 500 }),
        reason: 'queue-failed',
      },
      {
        outcome: 'queued',
        response: new NextResponse(null, { status: 200 }),
        reason: 'queued',
      },
    ])

    expect(response.status).toBe(200)
  })

  it('fails fast when a failed Slack dispatch carries a successful response', () => {
    expect(() =>
      getSlackDispatchFailureResponse({
        outcome: 'failed',
        response: new NextResponse(null, { status: 200 }),
        reason: 'queue-failed',
      })
    ).toThrow('Failed Slack dispatch returned successful HTTP status 200')
  })
})
