/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  OciAuthenticatedResponse,
  OciClient,
  OciRequest,
} from '@/lib/internal/oci/client.server'
import type { OciPreparedEndpoint } from '@/lib/internal/oci/endpoints'
import { OciClientError } from '@/lib/internal/oci/errors'
import { prepareOciQueueClient } from '@/lib/internal/oci-queue/endpoints'
import { executeOciQueueOperation } from '@/lib/internal/oci-queue/operations'
import { ociQueueInputSchema } from '@/lib/internal/oci-queue/schema'
import { OciQueueBlock } from '@/blocks/blocks/oci_queue'

const control = { region: { id: 'us-ashburn-1' } } as OciPreparedEndpoint
const data = {
  region: { id: 'us-ashburn-1' },
  origin: 'https://cell.queue.messaging.us-ashburn-1.oci.oraclecloud.com',
} as unknown as OciPreparedEndpoint
const request = vi.fn<(input: OciRequest) => Promise<OciAuthenticatedResponse>>()
const prepareDiscoveredEndpoint = vi.fn().mockResolvedValue(data)
const client: OciClient = {
  prepareStaticEndpoint: vi.fn().mockResolvedValue(control),
  prepareDiscoveredEndpoint,
  request,
}
const timestamp = '2026-01-01T00:00:00Z'
const summary = {
  id: 'queue',
  compartmentId: 'compartment',
  displayName: 'Jobs',
  lifecycleState: 'ACTIVE',
  timeCreated: timestamp,
  timeUpdated: timestamp,
  messagesEndpoint: 'https://cell.queue.messaging.us-ashburn-1.oci.oraclecloud.com',
}
const queue = {
  ...summary,
  retentionInSeconds: 86400,
  visibilityInSeconds: 30,
  timeoutInSeconds: 30,
  deadLetterQueueDeliveryCount: 3,
}
const work = {
  id: 'work',
  compartmentId: 'compartment',
  operationType: 'CREATE_QUEUE',
  status: 'SUCCEEDED',
  percentComplete: 100,
  timeAccepted: timestamp,
  resources: [],
}
const stats = { visibleMessages: 2, inFlightMessages: 1, sizeInBytes: 30 }

function response(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {}
): OciAuthenticatedResponse {
  return {
    status,
    headers,
    opcRequestId: 'request',
    body: new TextEncoder().encode(body === undefined ? '' : JSON.stringify(body)),
  } as OciAuthenticatedResponse
}

async function run(operation: string, values: Record<string, unknown> = {}, signal?: AbortSignal) {
  return executeOciQueueOperation(
    ociQueueInputSchema.parse({
      operation: `oci_queue_${operation}`,
      oauthCredential: 'credential',
      queueId: 'queue',
      workRequestId: 'work',
      ...values,
    }),
    await prepareOciQueueClient(client),
    signal
  )
}

describe('OCI Queue operation contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    request.mockReset()
    prepareDiscoveredEndpoint.mockReset().mockResolvedValue(data)
    vi.mocked(client.prepareStaticEndpoint).mockResolvedValue(control)
  })

  it('coerces active workflow inputs while preserving zero, receipts, and key removal', () => {
    const map = OciQueueBlock.tools.config!.params!
    const receive = map({
      operation: 'oci_queue_get_messages',
      oauthCredential: 'credential',
      queueId: 'queue',
      channelId: null,
      consumerGroupId: null,
      timeoutInSeconds: '0',
      visibilityInSeconds: '0',
      limit: null,
    })
    expect(
      ociQueueInputSchema.parse({ ...receive, operation: 'oci_queue_get_messages' })
    ).toMatchObject({ timeoutInSeconds: 0, visibilityInSeconds: 0 })
    expect(receive.channelFilter).toBeUndefined()
    expect(receive.consumerGroupId).toBeUndefined()
    const create = map({
      operation: 'oci_queue_create_queue',
      oauthCredential: 'credential',
      compartmentId: 'compartment',
      displayName: 'Jobs',
      customEncryptionKeyId: '',
    })
    expect(create.customEncryptionKeyId).toBeUndefined()
    const update = map({
      operation: 'oci_queue_update_queue',
      oauthCredential: 'credential',
      queueId: 'queue',
      customEncryptionKeyId: '',
    })
    expect(update.customEncryptionKeyId).toBe('')
    const acknowledge = map({
      operation: 'oci_queue_delete_message',
      oauthCredential: 'credential',
      queueId: 'queue',
      messageReceipt: ' receipt/+%2F= ',
    })
    expect(acknowledge.messageReceipt).toBe(' receipt/+%2F= ')
  })

  it('lists one filtered queue page and retains the opaque token', async () => {
    request.mockResolvedValue(response({ items: [summary] }, 200, { 'opc-next-page': 'next+/=' }))
    const output = await run('list_queues', {
      compartmentId: 'compartment',
      displayName: 'Jobs',
      id: 'queue',
      lifecycleState: 'ACTIVE',
      sortBy: 'displayName',
      sortOrder: 'ASC',
      limit: 12,
      page: 'page+/=',
    })
    expect(output).toMatchObject({
      queues: [summary],
      nextPage: 'next+/=',
      status: 200,
      requestId: 'request',
    })
    expect(request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: control,
        encodedPath: '/20210201/queues',
        method: 'GET',
        retry: { kind: 'safe', maxAttempts: 2 },
        queryPairs: expect.arrayContaining([
          ['limit', '12'],
          ['page', 'page+/='],
          ['displayName', 'Jobs'],
          ['compartmentId', 'compartment'],
          ['id', 'queue'],
          ['sortOrder', 'ASC'],
        ]),
      })
    )
  })

  it('gets queue configuration and projects documented capability names', async () => {
    request.mockResolvedValue(
      response({ ...queue, capabilities: [{ type: 'CONSUMER_GROUPS', ignored: true }] }, 200, {
        etag: 'etag',
      })
    )
    expect(await run('get_queue')).toMatchObject({
      queue: { ...queue, capabilities: ['CONSUMER_GROUPS'] },
      etag: 'etag',
    })
  })

  it('preserves ordinary numeric tag values named id', async () => {
    const definedTags = { business: { id: 123, enabled: true } }
    request.mockResolvedValueOnce(response({ ...queue, definedTags }))
    expect((await run('get_queue')).queue?.definedTags).toEqual(definedTags)
    request.mockResolvedValueOnce(response({ items: [{ ...summary, definedTags }] }))
    expect((await run('list_queues')).queues?.[0].definedTags).toEqual(definedTags)
  })

  it.each([
    [
      'create_queue',
      'POST',
      '/queues',
      { compartmentId: 'compartment', displayName: 'Jobs', retentionInSeconds: 10 },
      { compartmentId: 'compartment', displayName: 'Jobs', retentionInSeconds: 10 },
    ],
    [
      'update_queue',
      'PUT',
      '/queues/queue',
      { displayName: 'Renamed', customEncryptionKeyId: '', ifMatch: 'etag' },
      { displayName: 'Renamed', customEncryptionKeyId: '' },
    ],
    ['delete_queue', 'DELETE', '/queues/queue', { ifMatch: 'etag' }, undefined],
    [
      'change_queue_compartment',
      'POST',
      '/queues/queue/actions/changeCompartment',
      { destinationCompartmentId: 'destination', ifMatch: 'etag' },
      { compartmentId: 'destination' },
    ],
    [
      'purge_queue',
      'POST',
      '/queues/queue/actions/purge',
      { purgeType: 'BOTH', channelIds: ['jobs'], consumerGroupId: 'all', ifMatch: 'etag' },
      { purgeType: 'BOTH', channelIds: ['jobs'], consumerGroupId: 'all' },
    ],
  ] as const)(
    'preserves asynchronous acceptance for %s',
    async (operation, method, path, input, body) => {
      request.mockResolvedValue(response(undefined, 202, { 'opc-work-request-id': 'work' }))
      const output = await run(operation, input)
      expect(output).toMatchObject({ status: 202, workRequestId: 'work' })
      expect(output.queue).toBeUndefined()
      expect(request).toHaveBeenCalledTimes(1)
      const sent = request.mock.calls[0][0]
      expect(sent).toMatchObject({ method, encodedPath: `/20210201${path}`, endpoint: control })
      expect(sent.retry).toBeUndefined()
      expect(sent.body ? JSON.parse(new TextDecoder().decode(sent.body)) : undefined).toEqual(body)
      if ('ifMatch' in input) expect(sent.headers).toEqual({ 'if-match': 'etag' })
    }
  )

  it('passes only an explicit creation token through the foundation retry policy', async () => {
    request.mockResolvedValue(response(undefined, 202, { 'opc-work-request-id': 'work' }))
    await run('create_queue', {
      compartmentId: 'compartment',
      displayName: 'Jobs',
      retryToken: 'stable-token',
    })
    expect(request.mock.calls[0][0].retry).toEqual({
      kind: 'tokenized',
      maxAttempts: 2,
      retryToken: 'stable-token',
    })
  })

  it('rejects a 202 without the documented work request header', async () => {
    request.mockResolvedValue(response(undefined, 202))
    await expect(run('delete_queue')).rejects.toMatchObject({ status: 502 })
  })

  it('discovers with the authenticated response before publishing without retry', async () => {
    const discovery = response(queue)
    request
      .mockResolvedValueOnce(discovery)
      .mockResolvedValueOnce(response({ messages: [{ id: 42, expireAfter: timestamp }] }))
    const messages = [
      {
        content: 'hello',
        metadata: { channelId: 'jobs', customProperties: { team: 'operations' } },
      },
    ]
    const output = await run('put_messages', { messages })
    expect(prepareDiscoveredEndpoint).toHaveBeenCalledWith(
      expect.objectContaining({ serviceName: 'queue.messaging' }),
      discovery
    )
    expect(request.mock.calls[0][0]).toMatchObject({
      endpoint: control,
      method: 'GET',
      timeoutMs: 10000,
      retry: { kind: 'safe', maxAttempts: 2 },
    })
    const sent = request.mock.calls[1][0]
    expect(sent).toMatchObject({
      endpoint: data,
      method: 'POST',
      encodedPath: '/20210201/queues/queue/messages',
    })
    expect(sent.retry).toBeUndefined()
    expect(JSON.parse(new TextDecoder().decode(sent.body))).toEqual({ messages })
    expect(output.messages).toEqual([{ id: '42', expireAfter: timestamp }])
  })

  it.each([0, 10, 30, undefined])(
    'receives once with polling budget %s and cancellation',
    async (timeoutInSeconds) => {
      const controller = new AbortController()
      const receipt = ' opaque/+%2F= receipt '
      const message = {
        id: 42,
        content: '{"id":9007199254740993}',
        receipt,
        deliveryCount: 1,
        createdAt: timestamp,
        visibleAfter: timestamp,
        expireAfter: timestamp,
      }
      request
        .mockResolvedValueOnce(response(queue))
        .mockResolvedValueOnce(response({ messages: [message] }))
      const output = await run(
        'get_messages',
        {
          limit: 20,
          timeoutInSeconds,
          visibilityInSeconds: 0,
          channelFilter: 'jobs',
          consumerGroupId: 'group',
        },
        controller.signal
      )
      expect(output.messages).toEqual([{ ...message, id: '42' }])
      expect(request).toHaveBeenCalledTimes(2)
      expect(request.mock.calls.every(([sent]) => sent.signal === controller.signal)).toBe(true)
      const receive = request.mock.calls[1][0]
      expect(receive.timeoutMs).toBe(((timeoutInSeconds ?? 30) + 15) * 1000)
      expect(receive.retry).toBeUndefined()
      expect(receive.queryPairs).toEqual(
        expect.arrayContaining([
          ['limit', '20'],
          ['visibilityInSeconds', '0'],
          ['consumerGroupId', 'group'],
          ['channelFilter', 'jobs'],
        ])
      )
    }
  )

  it('preserves int64 IDs beyond Number.MAX_SAFE_INTEGER without changing message content', async () => {
    request.mockResolvedValueOnce(response(queue)).mockResolvedValueOnce({
      ...response({}),
      body: new TextEncoder().encode('{"messages":[{"id":9223372036854775807}]}'),
    })
    expect((await run('put_messages', { messages: [{ content: 'value' }] })).messages).toEqual([
      { id: '9223372036854775807' },
    ])
  })

  it('encodes a current receipt exactly once for deletion and accepts empty 204', async () => {
    request.mockResolvedValueOnce(response(queue)).mockResolvedValueOnce(response(undefined, 204))
    const receipt = ' receipt/+%2F= '
    expect(
      await run('delete_message', { messageReceipt: receipt, consumerGroupId: 'group' })
    ).toMatchObject({ status: 204 })
    expect(request.mock.calls[1][0]).toMatchObject({
      method: 'DELETE',
      encodedPath: `/20210201/queues/queue/messages/${encodeURIComponent(receipt)}`,
      queryPairs: [['consumerGroupId', 'group']],
    })
    expect(request.mock.calls[1][0].retry).toBeUndefined()
  })

  it('sets visibility to zero and returns the updated ID and timestamp', async () => {
    request
      .mockResolvedValueOnce(response(queue))
      .mockResolvedValueOnce(response({ id: 7, visibleAfter: timestamp }))
    expect(
      await run('update_message', { messageReceipt: 'r/+', visibilityInSeconds: 0 })
    ).toMatchObject({ updatedMessage: { id: '7', visibleAfter: timestamp } })
    const sent = request.mock.calls[1][0]
    expect(sent).toMatchObject({
      method: 'PUT',
      encodedPath: '/20210201/queues/queue/messages/r%2F%2B',
    })
    expect(JSON.parse(new TextDecoder().decode(sent.body))).toEqual({ visibilityInSeconds: 0 })
    expect(sent.retry).toBeUndefined()
  })

  it.each(['delete_messages', 'update_messages'])(
    'preserves ordered partial %s outcomes',
    async (operation) => {
      const update = operation === 'update_messages'
      const success = update ? { id: 9, visibleAfter: timestamp } : {}
      request.mockResolvedValueOnce(response(queue)).mockResolvedValueOnce(
        response({
          clientFailures: 1,
          serverFailures: 0,
          entries: [success, { errorCode: 400, errorMessage: 'Invalid receipt' }],
        })
      )
      const entries = ['r/+', 'old'].map((receipt) => ({
        receipt,
        ...(update ? { visibilityInSeconds: 20 } : {}),
      }))
      const output = await run(operation, { entries, consumerGroupId: 'group' })
      expect(output).toMatchObject({
        allSucceeded: false,
        clientFailures: 1,
        serverFailures: 0,
        entries: [
          { index: 0, success: true },
          { index: 1, success: false, errorCode: 400, errorMessage: 'Invalid receipt' },
        ],
      })
      const sent = request.mock.calls[1][0]
      expect(sent).toMatchObject({
        method: 'POST',
        encodedPath: `/20210201/queues/queue/messages/actions/${update ? 'updateMessages' : 'deleteMessages'}`,
        queryPairs: [['consumerGroupId', 'group']],
      })
      expect(JSON.parse(new TextDecoder().decode(sent.body))).toEqual({ entries })
      expect(sent.retry).toBeUndefined()
    }
  )

  it('rejects inconsistent batch counts without inventing successes', async () => {
    request.mockResolvedValueOnce(response(queue)).mockResolvedValueOnce(
      response({
        clientFailures: 0,
        serverFailures: 0,
        entries: [{ errorCode: 400, errorMessage: 'Invalid receipt' }],
      })
    )
    await expect(run('delete_messages', { entries: [{ receipt: 'r' }] })).rejects.toMatchObject({
      status: 502,
    })
  })

  it('returns scoped queue and DLQ statistics', async () => {
    request
      .mockResolvedValueOnce(response(queue))
      .mockResolvedValueOnce(
        response({ queue: stats, dlq: stats, channelId: 'jobs', consumerGroupId: 'group' })
      )
    expect(await run('get_stats', { channelId: 'jobs', consumerGroupId: 'group' })).toMatchObject({
      stats: { queue: stats, dlq: stats, channelId: 'jobs' },
    })
    expect(request.mock.calls[1][0]).toMatchObject({
      method: 'GET',
      encodedPath: '/20210201/queues/queue/stats',
      queryPairs: [
        ['channelId', 'jobs'],
        ['consumerGroupId', 'group'],
      ],
      retry: { kind: 'safe', maxAttempts: 2 },
    })
  })

  it.each([
    ['list_channels', '/queues/queue/channels', 'channels', ['jobs'], true],
    ['list_work_requests', '/workRequests', 'workRequests', [work], false],
    [
      'list_work_request_errors',
      '/workRequests/work/errors',
      'errors',
      [{ code: 'Failure', message: 'Details', timestamp }],
      false,
    ],
    [
      'list_work_request_logs',
      '/workRequests/work/logs',
      'logs',
      [{ message: 'Started', timestamp }],
      false,
    ],
  ] as const)(
    'returns one paginated %s result',
    async (operation, path, outputKey, items, discovery) => {
      if (discovery) request.mockResolvedValueOnce(response(queue))
      request.mockResolvedValueOnce(response({ items }, 200, { 'opc-next-page': 'next' }))
      const output = await run(operation, {
        limit: 4,
        page: 'page',
        compartmentId: 'compartment',
        channelFilter: 'jobs',
        consumerGroupId: 'group',
      })
      expect(output).toMatchObject({ [outputKey]: items, nextPage: 'next' })
      expect(request).toHaveBeenCalledTimes(discovery ? 2 : 1)
      expect(request.mock.lastCall?.[0]).toMatchObject({
        method: 'GET',
        encodedPath: `/20210201${path}`,
        queryPairs: expect.arrayContaining([
          ['limit', '4'],
          ['page', 'page'],
        ]),
        retry: { kind: 'safe', maxAttempts: 2 },
      })
    }
  )

  it('gets work status and preserves Retry-After', async () => {
    request.mockResolvedValue(response(work, 200, { 'retry-after': '15' }))
    expect(await run('get_work_request')).toMatchObject({ workRequest: work, retryAfter: 15 })
    expect(request.mock.calls[0][0].encodedPath).toBe('/20210201/workRequests/work')
  })

  it('enforces UTF-8 content and serialized batch byte limits before discovery', async () => {
    await expect(
      run('put_messages', { messages: [{ content: 'é'.repeat(131073) }] })
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      run('put_messages', {
        messages: [{ content: 'a'.repeat(262144) }, { content: 'a'.repeat(262144) }],
      })
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      run('put_messages', { messages: [{ content: '\n'.repeat(262144) }] })
    ).rejects.toMatchObject({ status: 400 })
    expect(request).not.toHaveBeenCalled()
  })

  it('accepts the content byte boundary and 20-entry batch boundary', async () => {
    request
      .mockResolvedValueOnce(response(queue))
      .mockResolvedValueOnce(response({ messages: [{ id: 1 }] }))
    await run('put_messages', { messages: [{ content: 'é'.repeat(131072) }] })
    expect(
      ociQueueInputSchema.safeParse({
        operation: 'oci_queue_delete_messages',
        oauthCredential: 'c',
        queueId: 'q',
        entries: Array.from({ length: 20 }, () => ({ receipt: 'r' })),
      }).success
    ).toBe(true)
  })

  it.each([0, 21])('rejects message and acknowledgement counts of %s', (count) => {
    for (const [operation, field, entry] of [
      ['put_messages', 'messages', { content: 'x' }],
      ['delete_messages', 'entries', { receipt: 'r' }],
      ['update_messages', 'entries', { receipt: 'r', visibilityInSeconds: 0 }],
    ] as const) {
      expect(
        ociQueueInputSchema.safeParse({
          operation: `oci_queue_${operation}`,
          oauthCredential: 'c',
          queueId: 'q',
          [field]: Array.from({ length: count }, () => entry),
        }).success
      ).toBe(false)
    }
  })

  it('does not repeat or compensate for a lost receive', async () => {
    request
      .mockResolvedValueOnce(response(queue))
      .mockRejectedValueOnce(new OciClientError('deadline_exceeded'))
    await expect(run('get_messages')).rejects.toMatchObject({ code: 'deadline_exceeded' })
    expect(request).toHaveBeenCalledTimes(2)
    expect(request.mock.calls[1][0].retry).toBeUndefined()
  })

  it('stops after cancelled discovery without a message request', async () => {
    const controller = new AbortController()
    request.mockImplementationOnce(async () => {
      controller.abort()
      return response(queue)
    })
    await expect(run('get_messages', {}, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('rejects untrusted discovery through the foundation policy without a message request', async () => {
    request.mockResolvedValue(response({ ...queue, messagesEndpoint: 'https://attacker.example' }))
    prepareDiscoveredEndpoint.mockRejectedValue(new OciClientError('invalid_endpoint'))
    await expect(run('get_messages')).rejects.toMatchObject({ code: 'invalid_endpoint' })
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('selects the documented regional control endpoint exception', async () => {
    vi.mocked(client.prepareStaticEndpoint).mockResolvedValue({
      region: { id: 'us-chicago-1' },
    } as OciPreparedEndpoint)
    await prepareOciQueueClient(client)
    expect(client.prepareStaticEndpoint).toHaveBeenLastCalledWith(
      expect.objectContaining({ hostnameTemplate: 'regional', serviceName: 'messaging' })
    )
  })
})
