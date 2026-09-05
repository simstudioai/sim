/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OciClient } from '@/lib/internal/oci/client.server'
import type { OciPreparedEndpoint } from '@/lib/internal/oci/endpoints'
import {
  executeOciLoggingOperation,
  OciLoggingResponseError,
} from '@/lib/internal/oci-logging/operations'
import type { OciLoggingOperation } from '@/tools/oci_logging/types'

const request = vi.fn()
const destination = {
  client: { request } as unknown as OciClient,
  endpoint: { origin: 'https://logging.us-phoenix-1.oci.oraclecloud.com' } as OciPreparedEndpoint,
}
const group = { id: 'group', compartmentId: 'compartment', displayName: 'Group' }
const log = {
  id: 'log',
  logGroupId: 'group',
  displayName: 'Log',
  logType: 'CUSTOM',
  lifecycleState: 'ACTIVE',
}
const search = {
  searchQuery: 'search "compartment/group/log" | summarize count() as count',
  timeStart: '2026-09-01T00:00:00Z',
  timeEnd: '2026-09-02T00:00:00Z',
}
const batch = {
  source: 'app',
  type: 'events',
  defaultlogentrytime: '2026-09-01T00:00:00.000Z',
  entries: [
    { id: 'caller-stable', data: '{"event":"hello"}', time: '2026-09-01T00:00:01.123+00:00' },
  ],
}
function respond(body: unknown, status = 200, headers: Record<string, string> = {}) {
  request.mockResolvedValue({
    status,
    headers,
    opcRequestId: 'oracle-request',
    body: body === undefined ? new Uint8Array() : new TextEncoder().encode(JSON.stringify(body)),
  })
}
function body() {
  return JSON.parse(new TextDecoder().decode(request.mock.calls[0]?.[0].body))
}
const execute = (operation: OciLoggingOperation, input: unknown, signal?: AbortSignal) =>
  executeOciLoggingOperation(operation, input, destination, signal)

describe('OCI Logging provider operations', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each([
    [
      'list_log_groups',
      { compartmentId: 'compartment' },
      '/20200531/logGroups',
      [group],
      'logGroups',
    ],
    ['get_log_group', { logGroupId: 'group' }, '/20200531/logGroups/group', group, 'logGroup'],
    ['list_logs', { logGroupId: 'group' }, '/20200531/logGroups/group/logs', [log], 'logs'],
    [
      'get_log',
      { logGroupId: 'group', logId: 'log' },
      '/20200531/logGroups/group/logs/log',
      log,
      'log',
    ],
    [
      'list_saved_searches',
      { compartmentId: 'compartment' },
      '/20200531/logSavedSearches',
      { items: [{ id: 'saved', compartmentId: 'compartment', name: 'Saved' }] },
      'savedSearches',
    ],
    [
      'get_saved_search',
      { logSavedSearchId: 'saved' },
      '/20200531/logSavedSearches/saved',
      { id: 'saved', compartmentId: 'compartment', name: 'Saved', query: search.searchQuery },
      'savedSearch',
    ],
    [
      'list_work_request_errors',
      { workRequestId: 'work' },
      '/20200531/workRequests/work/errors',
      [{ code: 'Failure', message: 'Work failed', timestamp: search.timeStart }],
      'errors',
    ],
  ] as const)('maps %s to its documented read envelope', async (op, input, path, response, key) => {
    respond(response, 200, { 'opc-next-page': 'next', etag: 'version' })
    const result = await execute(op, input)
    expect(result).toHaveProperty(key)
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        encodedPath: path,
        retry: { kind: 'safe', maxAttempts: 2 },
        timeoutMs: 60_000,
        maxResponseBytes: 10 * 1024 * 1024,
      })
    )
  })

  it.each([
    [
      'create_log_group',
      { compartmentId: 'compartment', displayName: 'New', retryToken: 'stable-token' },
      'POST',
      '/20200531/logGroups',
    ],
    [
      'update_log_group',
      { logGroupId: 'group', displayName: 'Updated', ifMatch: 'etag' },
      'PUT',
      '/20200531/logGroups/group',
    ],
    [
      'delete_log_group',
      { logGroupId: 'group', ifMatch: 'etag' },
      'DELETE',
      '/20200531/logGroups/group',
    ],
    [
      'create_log',
      { logGroupId: 'group', displayName: 'New', logType: 'CUSTOM', retryToken: 'stable-token' },
      'POST',
      '/20200531/logGroups/group/logs',
    ],
    [
      'update_log',
      { logGroupId: 'group', logId: 'log', isEnabled: false, ifMatch: 'etag' },
      'PUT',
      '/20200531/logGroups/group/logs/log',
    ],
    [
      'delete_log',
      { logGroupId: 'group', logId: 'log', ifMatch: 'etag' },
      'DELETE',
      '/20200531/logGroups/group/logs/log',
    ],
  ] as const)(
    'returns asynchronous acceptance for %s without inventing a resource',
    async (op, input, method, path) => {
      respond(undefined, 202, { 'opc-work-request-id': 'work' })
      expect(await execute(op, input)).toEqual({
        accepted: true,
        workRequestId: 'work',
        opcRequestId: 'oracle-request',
      })
      const call = request.mock.calls[0]?.[0]
      expect(call).toMatchObject({ method, encodedPath: path })
      if (method === 'POST')
        expect(call.retry).toEqual({
          kind: 'tokenized',
          maxAttempts: 2,
          retryToken: 'stable-token',
        })
      else {
        expect(call.retry).toBeUndefined()
        expect(call.headers).toEqual({ 'if-match': 'etag' })
      }
      if (method === 'DELETE') expect(call.body).toBeUndefined()
    }
  )

  it('preserves omitted update fields and explicit false, and rejects create-only source updates', async () => {
    respond(undefined, 202, { 'opc-work-request-id': 'work' })
    await execute('update_log', {
      logGroupId: 'group',
      logId: 'log',
      isEnabled: false,
      configuration: { source: { parameters: {} }, archiving: { isEnabled: false } },
      freeformTags: {},
    })
    expect(body()).toEqual({
      isEnabled: false,
      configuration: { source: { parameters: {} }, archiving: { isEnabled: false } },
      freeformTags: {},
    })
    request.mockClear()
    await expect(
      execute('update_log', {
        logGroupId: 'group',
        logId: 'log',
        configuration: { source: { service: 'flowlogs' } },
      })
    ).rejects.toThrow()
    expect(request).not.toHaveBeenCalled()
  })

  it('keeps continuation on empty filtered pages and sends false filters', async () => {
    respond([], 200, { 'opc-next-page': 'opaque+/=' })
    expect(
      await execute('list_log_groups', {
        compartmentId: 'compartment',
        isCompartmentIdInSubtree: false,
        displayName: 'filter',
        limit: 20,
        page: 'previous',
      })
    ).toEqual({ logGroups: [], nextPage: 'opaque+/=', opcRequestId: 'oracle-request' })
    expect(request.mock.calls[0]?.[0].queryPairs).toEqual(
      expect.arrayContaining([
        ['isCompartmentIdInSubtree', 'false'],
        ['page', 'previous'],
        ['limit', '20'],
      ])
    )
  })

  it('preserves native queries, timezone precision and dynamic aggregate rows on one search attempt', async () => {
    const results = [{ data: { count: 4, nested: { values: [true, null] } } }]
    respond({ results, summary: { resultCount: 1 } }, 200, { 'opc-next-page': 'next' })
    const input = {
      ...search,
      timeStart: '2026-09-01T02:00:00.123456+02:00',
      isReturnFieldInfo: false,
      page: 'previous',
      limit: 10,
    }
    expect(await execute('search_logs', input)).toEqual({
      results,
      fields: [],
      summary: { resultCount: 1 },
      nextPage: 'next',
      opcRequestId: 'oracle-request',
    })
    expect(body()).toEqual({
      searchQuery: input.searchQuery,
      timeStart: input.timeStart,
      timeEnd: input.timeEnd,
      isReturnFieldInfo: false,
    })
    expect(request.mock.calls[0]?.[0].retry).toBeUndefined()
    expect(request).toHaveBeenCalledTimes(1)
  })

  it.each(['2026-09-01T00:00:00Z', '2026-09-15T00:00:00.001Z', '2026-09-02'])(
    'rejects invalid search windows ending %s before sending',
    async (timeEnd) => {
      await expect(execute('search_logs', { ...search, timeEnd })).rejects.toThrow()
      expect(request).not.toHaveBeenCalled()
    }
  )

  it('sends caller IDs, entry contents and timestamps unchanged and returns only ingestion acceptance', async () => {
    respond(undefined)
    expect(await execute('put_logs', { logId: 'custom/log', logEntryBatches: [batch] })).toEqual({
      accepted: true,
      opcRequestId: 'oracle-request',
    })
    expect(body()).toEqual({ specversion: '1.0', logEntryBatches: [batch] })
    expect(request.mock.calls[0]?.[0]).toMatchObject({
      method: 'POST',
      encodedPath: '/20200831/logs/custom%2Flog/actions/push',
    })
    expect(request.mock.calls[0]?.[0].retry).toBeUndefined()
  })

  it.each([
    { logEntryBatches: [] },
    { logEntryBatches: [{ ...batch, entries: [] }] },
    { logEntryBatches: [{ ...batch, entries: [{ data: 'missing ID' }] }] },
    { logEntryBatches: [{ ...batch, entries: [{ id: 'large', data: 'é'.repeat(500_000) }] }] },
    { logEntryBatches: [{ ...batch, defaultlogentrytime: '2026-09-01T00:00:00Z' }] },
  ])(
    'validates the whole ingestion request before sending invalid batches',
    async ({ logEntryBatches }) => {
      await expect(execute('put_logs', { logId: 'custom', logEntryBatches })).rejects.toThrow()
      expect(request).not.toHaveBeenCalled()
    }
  )

  it('exposes documented work status, resource actions and polling advice', async () => {
    const workRequest = {
      id: 'work',
      compartmentId: 'compartment',
      operationType: 'CREATE_LOG',
      status: 'IN_PROGRESS',
      percentComplete: 20,
      resources: [{ actionType: 'IN_PROGRESS', entityType: 'log', identifier: 'log' }],
      timeAccepted: search.timeStart,
    }
    respond(workRequest, 200, { 'retry-after': '2', etag: 'version' })
    expect(await execute('get_work_request', { workRequestId: 'work' })).toEqual({
      workRequest,
      retryAfter: 2,
      etag: 'version',
      opcRequestId: 'oracle-request',
    })
  })

  it('rejects malformed provider envelopes and missing acceptance headers', async () => {
    respond({ results: [{ data: 'invalid' }], summary: {} })
    await expect(execute('search_logs', search)).rejects.toBeInstanceOf(OciLoggingResponseError)
    respond({ items: [group] })
    await expect(
      execute('list_log_groups', { compartmentId: 'compartment' })
    ).rejects.toBeInstanceOf(OciLoggingResponseError)
    respond(undefined, 202)
    await expect(execute('delete_log_group', { logGroupId: 'group' })).rejects.toBeInstanceOf(
      OciLoggingResponseError
    )
  })

  it('does not retry search or ingestion failures and honors cancellation', async () => {
    request.mockRejectedValue(new Error('network failure'))
    await expect(execute('search_logs', search)).rejects.toThrow('network failure')
    expect(request).toHaveBeenCalledTimes(1)
    request.mockClear()
    await expect(
      execute('put_logs', { logId: 'custom', logEntryBatches: [batch] })
    ).rejects.toThrow('network failure')
    expect(request).toHaveBeenCalledTimes(1)
    request.mockClear()
    const controller = new AbortController()
    controller.abort()
    await expect(execute('search_logs', search, controller.signal)).rejects.toThrow()
    expect(request).not.toHaveBeenCalled()
  })
})
