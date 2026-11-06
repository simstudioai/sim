import { createMockRequest } from '@sim/testing/mocks/request.mock'
import { describe, expect, it, vi } from 'vitest'
import { helpScoutHandler } from '@/lib/webhooks/providers/helpscout'
import type { AuthContext, EventMatchContext } from '@/lib/webhooks/providers/types'
import { getTrigger } from '@/triggers'

/** Payload, secret, and signature published in Help Scout's webhook verification docs. */
const DOC_BODY =
  '{"ticket":{"id":"1","number":"2"},"customer":{"id":"1","fname":"Jackie","lname":"Chan","email":"jackie.chan@somewhere.com","emails":["jackie.chan@somewhere.com"]}}'
const DOC_SECRET = 'your secret key'
const DOC_SIGNATURE = 'I1KlvGppYqvFTJgJ9jezdQMDiyI='

function authContext(
  rawBody: string,
  headers: Record<string, string>,
  webhookSecret?: string
): AuthContext {
  return {
    request: createMockRequest('POST', JSON.parse(rawBody), headers),
    rawBody,
    requestId: 'r1',
    providerConfig: webhookSecret === undefined ? {} : { webhookSecret },
    webhook: {},
    workflow: {},
  }
}

function matchContext(triggerId: string, eventType: string): EventMatchContext {
  return {
    webhook: { id: 'w1' },
    workflow: {},
    body: {},
    request: createMockRequest('POST', {}, { 'x-helpscout-event': eventType }),
    requestId: 'r1',
    providerConfig: { triggerId },
  }
}

describe('helpScoutHandler.verifyAuth', () => {
  it("accepts Help Scout's published signature vector", async () => {
    const res = await helpScoutHandler.verifyAuth?.(
      authContext(DOC_BODY, { 'x-helpscout-signature': DOC_SIGNATURE }, DOC_SECRET)
    )
    expect(res).toBeNull()
  })

  it.each([
    ['a tampered body', DOC_BODY.replace('Jackie', 'Jack'), DOC_SIGNATURE, DOC_SECRET],
    ['a different secret', DOC_BODY, DOC_SIGNATURE, 'another secret'],
    ['no signature header', DOC_BODY, undefined, DOC_SECRET],
    ['no configured secret', DOC_BODY, DOC_SIGNATURE, undefined],
  ])('rejects %s', async (_case, body, signature, secret) => {
    const headers: Record<string, string> = signature ? { 'x-helpscout-signature': signature } : {}
    const res = await helpScoutHandler.verifyAuth?.(authContext(body, headers, secret))
    expect(res?.status).toBe(401)
  })
})

describe('helpScoutHandler.matchEvent', () => {
  it.each([
    ['helpscout_customer_replied', 'convo.customer.reply.created', true],
    ['helpscout_customer_replied', 'convo.agent.reply.created', false],
    ['helpscout_conversation_deleted', 'convo.deleted', true],
    ['helpscout_customer_created', 'customer.updated', false],
    ['helpscout_webhook', 'tag.created', true],
  ])('%s receiving %s matches: %s', async (triggerId, eventType, expected) => {
    expect(await helpScoutHandler.matchEvent?.(matchContext(triggerId, eventType))).toBe(expected)
  })
})

async function format(triggerId: string, eventType: string, body: unknown) {
  const result = await helpScoutHandler.formatInput?.({
    webhook: { providerConfig: { triggerId } },
    workflow: { id: 'wf', userId: 'u' },
    body,
    headers: { 'x-helpscout-event': eventType },
    query: {},
    method: 'POST',
    requestId: 'r1',
  })
  return (result?.input ?? {}) as Record<string, unknown>
}

describe('helpScoutHandler.formatInput', () => {
  const conversation = {
    id: 123,
    number: 12,
    subject: 'Help',
    status: 'active',
    customerWaitingSince: { time: '2012-07-24T20:18:33Z', friendly: '20 hours ago' },
    _links: { web: { href: 'https://secure.helpscout.net/conversation/123/12' } },
  }
  const customer = {
    id: 500,
    firstName: 'Vernon',
    _embedded: { emails: [{ id: 1, value: 'bear@acme.com', type: 'home' }] },
  }

  it.each([
    ['helpscout_conversation_created', 'convo.created', conversation],
    ['helpscout_conversation_deleted', 'convo.deleted', { id: 456 }],
    ['helpscout_customer_created', 'customer.created', customer],
    ['helpscout_webhook', 'convo.created', conversation],
  ])('produces exactly the outputs %s declares', async (triggerId, eventType, body) => {
    const input = await format(triggerId, eventType, body)
    const outputs = getTrigger(triggerId).outputs
    expect(Object.keys(input).sort()).toEqual(Object.keys(outputs).sort())
    for (const nested of ['conversation', 'customer'] as const) {
      const value = input[nested]
      if (value) expect(Object.keys(value).sort()).toEqual(Object.keys(outputs[nested]).sort())
    }
  })

  it('flattens the waiting-since object and web link from a conversation payload', async () => {
    const input = await format('helpscout_conversation_created', 'convo.created', conversation)
    expect(input).toMatchObject({
      eventType: 'convo.created',
      conversationId: 123,
      conversation: {
        customerWaitingSince: '2012-07-24T20:18:33Z',
        webUrl: 'https://secure.helpscout.net/conversation/123/12',
      },
    })
  })
})

describe('helpScoutHandler.deleteSubscription', () => {
  it('finishes strict cleanup for a trigger with no Sim-managed webhook', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await expect(
      helpScoutHandler.deleteSubscription?.({
        webhook: { id: 'w1', providerConfig: { webhookSecret: 'manual-secret' } },
        workflow: {},
        requestId: 'r1',
        strict: true,
      })
    ).resolves.toBeUndefined()
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('still fails strict cleanup when the stored webhook ID is malformed', async () => {
    await expect(
      helpScoutHandler.deleteSubscription?.({
        webhook: { id: 'w1', providerConfig: { externalId: 'not-a-number' } },
        workflow: {},
        requestId: 'r1',
        strict: true,
      })
    ).rejects.toThrow('Invalid Help Scout webhook ID')
  })
})
