/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  OciAuthenticatedResponse,
  OciClient,
  OciRequest,
} from '@/lib/internal/oci/client.server'
import type { OciPreparedEndpoint } from '@/lib/internal/oci/endpoints'
import { OciClientError } from '@/lib/internal/oci/errors'
import { prepareOciNotificationsClient } from '@/lib/internal/oci-notifications/endpoints'
import { executeOciNotificationsOperation } from '@/lib/internal/oci-notifications/operations'
import { ociNotificationsInputSchema } from '@/lib/internal/oci-notifications/schema'

const control = { region: { id: 'us-ashburn-1' } } as OciPreparedEndpoint
const data = {
  origin: 'https://cell1.notification.us-ashburn-1.oci.oraclecloud.com',
} as OciPreparedEndpoint
const request = vi.fn<(input: OciRequest) => Promise<OciAuthenticatedResponse>>()
const prepareDiscoveredEndpoint = vi.fn().mockResolvedValue(data)
const client: OciClient = {
  prepareStaticEndpoint: vi.fn().mockResolvedValue(control),
  prepareDiscoveredEndpoint,
  request,
}
const topic = {
  topicId: 'topic',
  name: 'Operations',
  compartmentId: 'topic-compartment',
  lifecycleState: 'ACTIVE',
  timeCreated: '2026-01-01T00:00:00Z',
  apiEndpoint: data.origin,
}
const subscription = {
  id: 'subscription',
  topicId: 'topic',
  compartmentId: 'subscription-compartment',
  protocol: 'EMAIL',
  endpoint: 'recipient@example.com',
  lifecycleState: 'PENDING',
}

function response(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {}
): OciAuthenticatedResponse {
  return {
    status,
    headers,
    opcRequestId: 'oracle-request',
    body: new TextEncoder().encode(body === undefined ? '' : JSON.stringify(body)),
  } as OciAuthenticatedResponse
}

async function run(operation: string, values: Record<string, unknown> = {}, signal?: AbortSignal) {
  return executeOciNotificationsOperation(
    ociNotificationsInputSchema.parse({
      operation: `oci_notifications_${operation}`,
      oauthCredential: 'credential',
      topicId: 'topic',
      subscriptionId: 'subscription',
      ...values,
    }),
    await prepareOciNotificationsClient(client),
    signal
  )
}

function sentBody(index = 0) {
  return JSON.parse(new TextDecoder().decode(request.mock.calls[index][0].body))
}

describe('OCI Notifications operation contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    request.mockReset()
    prepareDiscoveredEndpoint.mockReset().mockResolvedValue(data)
  })

  it('lists one bare topic array and preserves opaque pagination without discovery', async () => {
    request.mockResolvedValue(response([topic], 200, { 'opc-next-page': 'next+/=' }))
    expect(
      await run('list_topics', {
        compartmentId: ' compartment ',
        page: ' page+/= ',
        limit: 50,
        name: 'Operations',
        sortBy: 'TIMECREATED',
      })
    ).toMatchObject({ topics: [topic], nextPage: 'next+/=' })
    expect(request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: control,
        method: 'GET',
        encodedPath: '/20181201/topics',
        queryPairs: expect.arrayContaining([
          ['compartmentId', 'compartment'],
          ['page', ' page+/= '],
          ['limit', '50'],
          ['sortBy', 'TIMECREATED'],
        ]),
      })
    )
    expect(prepareDiscoveredEndpoint).not.toHaveBeenCalled()
  })

  it('discovers subscriptions from the original authenticated topic response', async () => {
    const discovery = response(topic)
    request.mockResolvedValueOnce(discovery).mockResolvedValueOnce(response([subscription]))
    const signal = new AbortController().signal
    expect(
      await run(
        'list_subscriptions',
        { compartmentId: 'subscription-compartment', limit: 10 },
        signal
      )
    ).toMatchObject({ subscriptions: [subscription] })
    expect(prepareDiscoveredEndpoint.mock.calls[0][1]).toBe(discovery)
    expect(prepareDiscoveredEndpoint.mock.calls[0][0]).toMatchObject({
      kind: 'authenticated-discovery',
      serviceId: 'oci-notifications',
      source: { kind: 'json', path: ['apiEndpoint'] },
    })
    expect(request.mock.calls[1][0]).toMatchObject({
      endpoint: data,
      encodedPath: '/20181201/subscriptions',
      queryPairs: [
        ['compartmentId', 'subscription-compartment'],
        ['topicId', 'topic'],
        ['limit', '10'],
      ],
      signal,
    })
  })

  it('keeps legacy deliverPolicy on full subscriptions only', async () => {
    const full = { ...subscription, deliverPolicy: '{}' }
    request.mockResolvedValueOnce(response(topic)).mockResolvedValueOnce(response([full]))
    const listed = await run('list_subscriptions', { compartmentId: 'subscription-compartment' })
    expect(listed.subscriptions?.[0]).not.toHaveProperty('deliverPolicy')
    request.mockResolvedValueOnce(response(topic)).mockResolvedValueOnce(response(full))
    expect((await run('get_subscription')).subscription?.deliverPolicy).toBe('{}')
  })

  it('creates topics with documented tags and no automatic retry without a token', async () => {
    request.mockResolvedValueOnce(response(topic))
    await run('create_topic', {
      compartmentId: 'topic-compartment',
      name: 'Operations',
      definedTags: { Operations: { CostCenter: '42' } },
    })
    expect(sentBody()).toEqual({
      compartmentId: 'topic-compartment',
      name: 'Operations',
      definedTags: { Operations: { CostCenter: '42' } },
    })
    expect(request.mock.calls[0][0]).toMatchObject({
      method: 'POST',
      endpoint: control,
      encodedPath: '/20181201/topics',
    })
    expect(request.mock.calls[0][0].retry).toBeUndefined()
  })

  it('rejects wrong-topic discovery and a destination refused by the foundation', async () => {
    request.mockResolvedValueOnce(response({ ...topic, topicId: 'other' }))
    await expect(run('publish_message', { body: 'Hello' })).rejects.toMatchObject({
      code: 'invalid_endpoint',
    })
    expect(prepareDiscoveredEndpoint).not.toHaveBeenCalled()
    request.mockResolvedValueOnce(response(topic))
    prepareDiscoveredEndpoint.mockRejectedValueOnce(new OciClientError('invalid_endpoint'))
    await expect(run('publish_message', { body: 'Hello' })).rejects.toMatchObject({
      code: 'invalid_endpoint',
    })
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('creates in the authenticated parent compartment without exposing a confirmation URL', async () => {
    request.mockResolvedValueOnce(response(topic)).mockResolvedValueOnce(response(subscription))
    const output = await run('create_subscription', {
      protocol: 'EMAIL',
      endpoint: 'recipient@example.com',
      compartmentId: 'untrusted',
      retryToken: 'creation-token',
    })
    expect(sentBody(1)).toEqual({
      topicId: 'topic',
      compartmentId: 'topic-compartment',
      protocol: 'EMAIL',
      endpoint: 'recipient@example.com',
    })
    expect(request.mock.calls[1][0].retry).toEqual({
      kind: 'tokenized',
      maxAttempts: 2,
      retryToken: 'creation-token',
    })
    expect(output.subscription?.lifecycleState).toBe('PENDING')
    expect(output).not.toHaveProperty('confirmationUrl')
  })

  it('returns update details rather than requiring a full subscription', async () => {
    const update = {
      deliveryPolicy: {
        backoffRetryPolicy: { policyType: 'EXPONENTIAL', maxRetryDuration: 60_000 },
      },
      freeformTags: { Team: 'Operations' },
    }
    request
      .mockResolvedValueOnce(response(topic))
      .mockResolvedValueOnce(response(update, 200, { etag: 'v2' }))
    expect(await run('update_subscription', { ...update, ifMatch: 'v1' })).toMatchObject({
      subscriptionUpdate: update,
      etag: 'v2',
    })
    expect(request.mock.calls[1][0]).toMatchObject({ method: 'PUT', headers: { 'if-match': 'v1' } })
    expect(sentBody(1)).toEqual(update)
  })

  it('resends using a signed empty POST and returns the subscription without retrying', async () => {
    request.mockResolvedValueOnce(response(topic)).mockResolvedValueOnce(response(subscription))
    expect(await run('resend_subscription_confirmation')).toMatchObject({ subscription })
    expect(request.mock.calls[1][0]).toMatchObject({
      method: 'POST',
      encodedPath: '/20181201/subscriptions/subscription/resendConfirmation',
      contentType: 'application/json',
      body: new Uint8Array(0),
    })
    expect(request.mock.calls[1][0].retry).toBeUndefined()
  })

  it.each([
    ['delete_topic', '/topics/topic', false],
    ['change_topic_compartment', '/topics/topic/actions/changeCompartment', false],
    ['delete_subscription', '/subscriptions/subscription', true],
    [
      'change_subscription_compartment',
      '/subscriptions/subscription/actions/changeCompartment',
      true,
    ],
  ])('handles empty success for %s', async (operation, path, discovered) => {
    if (discovered) request.mockResolvedValueOnce(response(topic))
    request.mockResolvedValueOnce(response(undefined, 204))
    expect(
      await run(operation, { destinationCompartmentId: 'destination', ifMatch: 'etag' })
    ).toMatchObject({ status: 204, requestId: 'oracle-request' })
    const sent = request.mock.calls[discovered ? 1 : 0][0]
    expect(sent).toMatchObject({
      endpoint: discovered ? data : control,
      encodedPath: `/20181201${path}`,
      method: operation.startsWith('delete') ? 'DELETE' : 'POST',
      headers: { 'if-match': 'etag' },
    })
    if (operation.startsWith('change')) {
      expect(sentBody(discovered ? 1 : 0)).toEqual({ compartmentId: 'destination' })
    }
    expect(sent.retry).toBeUndefined()
  })

  it.each(['add_topic_lock', 'remove_topic_lock'])(
    'sends a lock object for %s',
    async (operation) => {
      const lock = { type: 'DELETE', compartmentId: 'lock-compartment', message: 'Retain topic' }
      request.mockResolvedValue(response({ ...topic, locks: [lock] }))
      expect(await run(operation, { lock, ifMatch: 'v1' })).toMatchObject({
        topic: { locks: [lock] },
      })
      expect(sentBody()).toEqual(lock)
      expect(request.mock.calls[0][0]).toMatchObject({
        method: 'POST',
        encodedPath: `/20181201/topics/topic/actions/${operation.startsWith('add') ? 'addLock' : 'removeLock'}`,
        headers: { 'if-match': 'v1' },
      })
    }
  )

  it('keeps lock overrides in query and allows clearing a required topic description', async () => {
    request.mockResolvedValue(response(topic))
    await run('update_topic', { description: '', isLockOverride: true })
    expect(sentBody()).toEqual({ description: '' })
    expect(request.mock.calls[0][0].queryPairs).toEqual([['isLockOverride', 'true']])
    await expect(run('update_topic')).rejects.toThrow()
  })

  it('encodes identifiers and tokenizes only explicitly supported mutations', async () => {
    request.mockResolvedValue(response(undefined, 204))
    await run('change_topic_compartment', {
      topicId: ' topic/+% ',
      destinationCompartmentId: 'destination',
      retryToken: 'move-token',
    })
    expect(request.mock.calls[0][0]).toMatchObject({
      encodedPath: '/20181201/topics/topic%2F%2B%25/actions/changeCompartment',
      retry: { kind: 'tokenized', maxAttempts: 2, retryToken: 'move-token' },
    })
  })

  it('counts serialized UTF-8 bytes before discovery and preserves the exact publish result', async () => {
    await expect(run('publish_message', { body: '😀'.repeat(16_000) })).rejects.toMatchObject({
      status: 413,
    })
    await expect(run('publish_message', { body: '"'.repeat(32_000) })).rejects.toMatchObject({
      status: 413,
    })
    expect(request).not.toHaveBeenCalled()
    const published = { messageId: 'message', timeStamp: '2026-01-01T00:00:00Z' }
    request.mockResolvedValueOnce(response(topic)).mockResolvedValueOnce(response(published))
    expect(await run('publish_message', { body: 'a'.repeat(63_989) })).toMatchObject(published)
    expect(request.mock.calls[1][0].body?.byteLength).toBe(64_000)
    expect(request.mock.calls[1][0].retry).toBeUndefined()
    expect(request.mock.calls[1][0].headers).toBeUndefined()
  })

  it.each([
    new OciClientError('request_failed'),
    new OciClientError('deadline_exceeded'),
    new OciClientError('request_failed', { status: 500, opcRequestId: 'failed-request' }),
  ])('never repeats an ambiguously failed publish: %s', async (error) => {
    request.mockResolvedValueOnce(response(topic)).mockRejectedValueOnce(error)
    await expect(run('publish_message', { body: 'Hello' })).rejects.toThrow('acceptance is unknown')
    expect(request).toHaveBeenCalledTimes(2)
    expect(request.mock.calls[1][0].retry).toBeUndefined()
  })

  it('treats malformed publish success as ambiguous, without inventing a message ID', async () => {
    request
      .mockResolvedValueOnce(response(topic))
      .mockResolvedValueOnce(response({ accepted: true }))
    await expect(run('publish_message', { body: 'Hello' })).rejects.toMatchObject({
      message: expect.stringContaining('acceptance is unknown'),
      requestId: 'oracle-request',
    })
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('validates page limits, retry duration, and deprecated protocols', async () => {
    await expect(run('list_topics', { compartmentId: 'compartment', limit: 51 })).rejects.toThrow()
    await expect(
      run('update_subscription', {
        deliveryPolicy: {
          backoffRetryPolicy: { policyType: 'EXPONENTIAL', maxRetryDuration: 59_999 },
        },
      })
    ).rejects.toThrow()
    await expect(
      run('create_subscription', { protocol: 'HTTPS', endpoint: 'https://example.com' })
    ).rejects.toThrow()
    expect(request).not.toHaveBeenCalled()
  })

  it('does not send after cancellation', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(run('get_topic', {}, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(request).not.toHaveBeenCalled()
  })
})
