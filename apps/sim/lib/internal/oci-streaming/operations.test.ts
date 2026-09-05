/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OciAuthenticatedResponse, OciClient } from '@/lib/internal/oci/client.server'
import type { OciPreparedEndpoint } from '@/lib/internal/oci/endpoints'
import {
  buildOciStreamingPublishBody,
  executeOciStreamingOperation,
  OCI_STREAMING_MESSAGES_ENDPOINT,
  parseOciStreamingJson,
  serializeOciStreamingJson,
  withOciStreamingBudget,
} from '@/lib/internal/oci-streaming/operations'
import { ociStreamingInputSchema, offsetSchema } from '@/lib/internal/oci-streaming/schema'

const bytes = (text: string) => new TextEncoder().encode(text)
const admin = {
  origin: 'https://streaming.us-ashburn-1.oci.oraclecloud.com',
} as OciPreparedEndpoint
const messages = {
  origin: 'https://cell-1.streaming.us-ashburn-1.oci.oraclecloud.com',
} as OciPreparedEndpoint
const response = (body: string, headers: Record<string, string> = {}, status = 200) =>
  ({
    body: bytes(body),
    headers,
    status,
    opcRequestId: 'oracle-request',
  }) as OciAuthenticatedResponse
const stream = {
  id: 'stream-1',
  name: 'events',
  compartmentId: 'compartment-1',
  streamPoolId: 'pool-1',
  partitions: 1,
  lifecycleState: 'ACTIVE',
  timeCreated: '2026-01-01T00:00:00Z',
  retentionInHours: 24,
  messagesEndpoint: messages.origin,
}

function harness() {
  const request = vi.fn<OciClient['request']>()
  const discover = vi.fn<OciClient['prepareDiscoveredEndpoint']>().mockResolvedValue(messages)
  const client: OciClient = {
    request,
    prepareDiscoveredEndpoint: discover,
    prepareStaticEndpoint: vi.fn().mockResolvedValue(admin),
  }
  const execute = (input: Record<string, unknown>, signal?: AbortSignal) =>
    withOciStreamingBudget(
      (budget) =>
        executeOciStreamingOperation(
          ociStreamingInputSchema.parse({ ociCredential: 'credential-1', ...input }),
          { client, endpoint: admin },
          budget
        ),
      signal
    )
  return { request, discover, execute }
}

afterEach(() => vi.useRealTimers())

describe('OCI Streaming request and response semantics', () => {
  it('accepts full resource names, bounds group paths, and preserves empty tag updates', () => {
    const create = {
      operation: 'create_stream',
      ociCredential: 'credential',
      compartmentId: 'compartment',
      partitions: 1,
    }
    expect(ociStreamingInputSchema.safeParse({ ...create, name: 'x'.repeat(1024) }).success).toBe(
      true
    )
    expect(ociStreamingInputSchema.safeParse({ ...create, name: 'x'.repeat(1025) }).success).toBe(
      false
    )
    const group = { operation: 'get_group', ociCredential: 'credential', streamId: 'stream' }
    expect(
      ociStreamingInputSchema.safeParse({ ...group, groupName: 'x'.repeat(255) }).success
    ).toBe(true)
    expect(
      ociStreamingInputSchema.safeParse({ ...group, groupName: 'x'.repeat(256) }).success
    ).toBe(false)
    expect(
      ociStreamingInputSchema.parse({
        operation: 'update_stream',
        ociCredential: 'credential',
        streamId: 'stream',
        freeformTags: {},
        definedTags: {},
      })
    ).toMatchObject({ freeformTags: {}, definedTags: {} })
  })

  it('uses the original authenticated discovery response and keeps an empty batch cursor', async () => {
    const h = harness()
    const original = response(JSON.stringify(stream))
    h.request
      .mockResolvedValueOnce(original)
      .mockResolvedValueOnce(response('[]', { 'opc-next-cursor': 'opaque+next/=' }))
    const result = await h.execute({
      operation: 'get_messages',
      streamId: 'stream-1',
      cursor: 'opaque-input',
    })
    expect(h.discover).toHaveBeenCalledWith(OCI_STREAMING_MESSAGES_ENDPOINT, original)
    expect(h.discover.mock.calls[0][1]).toBe(original)
    expect(result.output).toMatchObject({ messages: [], nextCursor: 'opaque+next/=' })
    expect(result.output).not.toHaveProperty('nextPage')
    expect(h.request.mock.calls[1][0]).toMatchObject({
      endpoint: messages,
      method: 'GET',
      queryPairs: [
        ['cursor', 'opaque-input'],
        ['limit', '100'],
      ],
      maxResponseBytes: 8 * 1024 * 1024,
    })
    expect(h.request.mock.calls[1][0].retry).toBeUndefined()
    expect(h.request).toHaveBeenCalledTimes(2)
  })

  it('stops before discovery preparation when canceled after GetStream', async () => {
    const h = harness()
    const controller = new AbortController()
    h.request.mockImplementationOnce(async () => {
      controller.abort(new DOMException('Canceled', 'AbortError'))
      return response(JSON.stringify(stream))
    })
    await expect(
      h.execute(
        { operation: 'get_messages', streamId: 'stream-1', cursor: 'cursor' },
        controller.signal
      )
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(h.discover).not.toHaveBeenCalled()
    expect(h.request).toHaveBeenCalledOnce()
  })

  it.each(['9007199254740993', '9223372036854775807'])(
    'round-trips offset %s without Number conversion',
    async (offset) => {
      expect(parseOciStreamingJson(bytes(`{"offset":${offset}}`), 'offset')).toEqual({ offset })
      expect(new TextDecoder().decode(serializeOciStreamingJson({ offset }))).toBe(
        `{"offset":${offset}}`
      )
      const h = harness()
      h.request
        .mockResolvedValueOnce(response(JSON.stringify(stream)))
        .mockResolvedValueOnce(response('{"value":"cursor"}'))
      await h.execute({
        operation: 'create_cursor',
        streamId: 'stream-1',
        partition: '0',
        type: 'AT_OFFSET',
        offset,
      })
      expect(new TextDecoder().decode(h.request.mock.calls[1][0].body)).toContain(
        `"offset":${offset}`
      )
    }
  )

  it('accepts a full-size canonical base64 value without recursive pattern matching', () => {
    const value = Buffer.alloc(1024 * 1024, 97).toString('base64')
    const body = buildOciStreamingPublishBody({
      operation: 'put_messages',
      ociCredential: 'credential',
      streamId: 'stream',
      encoding: 'base64',
      messages: [{ value }],
    })
    expect(JSON.parse(new TextDecoder().decode(body))).toEqual({ messages: [{ key: null, value }] })
  })

  it.each(['-1', '01', '1.0', '1e3', '9223372036854775808', 'wrong'])(
    'rejects invalid input offset %s',
    (offset) => {
      expect(offsetSchema.safeParse(offset).success).toBe(false)
    }
  )

  it('keeps signed committed offsets and does not rewrite administrative tag values', () => {
    expect(parseOciStreamingJson(bytes('{"committedOffset":-1}'), 'committedOffset')).toEqual({
      committedOffset: '-1',
    })
    expect(parseOciStreamingJson(bytes('{"freeformTags":{"offset":"9007199254740993"}}'))).toEqual({
      freeformTags: { offset: '9007199254740993' },
    })
  })

  it('preserves ordered partial publish successes without replaying', async () => {
    const h = harness()
    h.request
      .mockResolvedValueOnce(response(JSON.stringify(stream)))
      .mockResolvedValueOnce(
        response(
          '{"failures":1,"entries":[{"offset":9007199254740993,"partition":"0","timestamp":"2026-01-01T00:00:00Z"},{"error":"TooManyRequests","errorMessage":"Throttled"}]}'
        )
      )
    const result = await h.execute({
      operation: 'put_messages',
      streamId: 'stream-1',
      messages: [{ key: 'é', value: 'first' }, { value: 'second' }],
    })
    expect(result).toMatchObject({
      success: true,
      output: {
        failures: 1,
        allSucceeded: false,
        entries: [{ offset: '9007199254740993' }, { error: 'TooManyRequests' }],
      },
    })
    const wire = h.request.mock.calls[1][0]
    expect(JSON.parse(new TextDecoder().decode(wire.body))).toEqual({
      messages: [
        { key: 'w6k=', value: 'Zmlyc3Q=' },
        { key: null, value: 'c2Vjb25k' },
      ],
    })
    expect(wire.retry).toBeUndefined()
    expect(h.request).toHaveBeenCalledTimes(2)
  })

  it('enforces decoded key and batch limits, including strict base64', () => {
    const publish = (messages: unknown, encoding = 'utf-8') => {
      const input = ociStreamingInputSchema.parse({
        operation: 'put_messages',
        ociCredential: 'credential',
        streamId: 'stream',
        messages,
        encoding,
      })
      if (input.operation !== 'put_messages') throw new Error('Unexpected input')
      return buildOciStreamingPublishBody(input)
    }
    expect(() => publish([{ key: 'é'.repeat(129), value: 'value' }])).toThrow('256')
    expect(() => publish([{ value: 'x'.repeat(1_048_576) }, { value: 'x' }])).toThrow('1 MiB')
    expect(() => publish([{ value: 'a===' }], 'base64')).toThrow('base64')
    expect(() => publish([{ value: 'Zh==' }], 'base64')).toThrow('base64')
    expect(() => publish([{ value: '' }])).toThrow()
    expect(() => publish(Array.from({ length: 1001 }, () => ({ value: 'x' })))).toThrow()
    expect(publish([{ value: 'eA==' }], 'base64').byteLength).toBeLessThan(2 * 1024 * 1024)
  })

  it.each(['consumer_commit', 'consumer_heartbeat'])(
    '%s uses an empty POST body and returns a replacement cursor',
    async (operation) => {
      const h = harness()
      h.request
        .mockResolvedValueOnce(response(JSON.stringify(stream)))
        .mockResolvedValueOnce(response('{"value":"replacement"}'))
      const result = await h.execute({
        operation,
        streamId: 'stream-1',
        cursor: 'read-next-cursor',
      })
      expect(result.output.cursor).toBe('replacement')
      expect(h.request.mock.calls[1][0]).toMatchObject({
        method: 'POST',
        body: new Uint8Array(0),
        queryPairs: [['cursor', 'read-next-cursor']],
      })
      expect(h.request.mock.calls[1][0].retry).toBeUndefined()
    }
  )

  it('defaults group reads to manual commits and recognizes UpdateGroup empty success', async () => {
    const h = harness()
    h.request
      .mockResolvedValueOnce(response(JSON.stringify(stream)))
      .mockResolvedValueOnce(response('{"value":"group-cursor"}'))
    await h.execute({
      operation: 'create_group_cursor',
      streamId: 'stream-1',
      groupName: 'workers',
      type: 'LATEST',
    })
    expect(JSON.parse(new TextDecoder().decode(h.request.mock.calls[1][0].body))).toMatchObject({
      commitOnGet: false,
    })
    h.request
      .mockResolvedValueOnce(response(JSON.stringify(stream)))
      .mockResolvedValueOnce(response(''))
    const result = await h.execute({
      operation: 'update_group',
      streamId: 'stream-1',
      groupName: 'a/b',
      type: 'TRIM_HORIZON',
    })
    expect(result.output).toEqual({
      status: 200,
      requestId: 'oracle-request',
      etag: null,
      workRequestId: null,
    })
    expect(h.request.mock.calls[3][0].encodedPath).toBe('/20180418/streams/stream-1/groups/a%2Fb')
  })

  it.each([
    { operation: 'create_cursor', partition: '0', type: 'AT_OFFSET' },
    { operation: 'create_cursor', partition: '0', type: 'LATEST', offset: '1' },
    { operation: 'create_group_cursor', groupName: 'group', type: 'AT_OFFSET', offset: '1' },
    { operation: 'create_group_cursor', groupName: 'group', type: 'AT_TIME' },
  ])('validates distinct cursor modes: $operation $type', (input) => {
    expect(
      ociStreamingInputSchema.safeParse({
        ociCredential: 'credential',
        streamId: 'stream',
        ...input,
      }).success
    ).toBe(false)
  })

  it('projects bare resource pages separately from work-request envelopes', async () => {
    const h = harness()
    h.request.mockResolvedValueOnce(
      response(JSON.stringify([stream]), { 'opc-next-page': 'page-two' })
    )
    expect(
      (await h.execute({ operation: 'list_streams', compartmentId: 'compartment-1' })).output
    ).toMatchObject({ streams: [{ id: 'stream-1' }], nextPage: 'page-two' })
    expect(h.request.mock.calls[0][0].retry).toEqual({ kind: 'safe', maxAttempts: 2 })
    h.request.mockResolvedValueOnce(
      response(
        '{"items":[{"code":"Failed","message":"Provisioning failed","timestamp":"2026-01-01T00:00:00Z"}]}'
      )
    )
    expect(
      (await h.execute({ operation: 'list_work_request_errors', workRequestId: 'work' })).output
    ).toMatchObject({ errors: [{ code: 'Failed' }], nextPage: null })
  })

  it('preserves ETags and asynchronous IDs without claiming completion', async () => {
    const h = harness()
    h.request.mockResolvedValueOnce(
      response(JSON.stringify({ ...stream, lifecycleState: 'CREATING' }), {
        etag: 'version-1',
        'opc-work-request-id': 'work-1',
      })
    )
    const result = await h.execute({
      operation: 'create_stream',
      name: 'events',
      partitions: 1,
      compartmentId: 'compartment-1',
    })
    expect(result.output).toMatchObject({
      etag: 'version-1',
      workRequestId: 'work-1',
      stream: { lifecycleState: 'CREATING' },
    })
    expect(h.request.mock.calls[0][0].retry).toBeUndefined()
  })

  it('uses tokenized retries only for explicit CreateStreamPool retry tokens', async () => {
    const h = harness()
    const pool = {
      id: 'pool',
      name: 'events',
      compartmentId: 'compartment',
      lifecycleState: 'CREATING',
      timeCreated: '2026-01-01T00:00:00Z',
      kafkaSettings: {},
      customEncryptionKey: {},
    }
    h.request.mockResolvedValue(response(JSON.stringify(pool)))
    await h.execute({
      operation: 'create_stream_pool',
      name: 'events',
      compartmentId: 'compartment',
    })
    expect(h.request.mock.calls[0][0].retry).toBeUndefined()
    await h.execute({
      operation: 'create_stream_pool',
      name: 'events',
      compartmentId: 'compartment',
      retryToken: 'token',
    })
    expect(h.request.mock.calls[1][0].retry).toEqual({
      kind: 'tokenized',
      maxAttempts: 2,
      retryToken: 'token',
    })
    expect(h.request.mock.calls[1][0].headers).not.toHaveProperty('opc-retry-token')
    expect(h.request.mock.calls[1][0].body).toEqual(h.request.mock.calls[0][0].body)
  })

  it('bounds an unresolved operation by the overall deadline', async () => {
    vi.useFakeTimers()
    const pending = withOciStreamingBudget(() => new Promise(() => {}))
    const assertion = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' })
    await vi.advanceTimersByTimeAsync(60_000)
    await assertion
  })
})
