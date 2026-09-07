/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OciClient, OciRequest } from '@/lib/internal/oci/client.server'
import { OciClientError } from '@/lib/internal/oci/errors'
import { type OciEventsOperation, ociEventsInputSchemas } from '@/lib/internal/oci-events/input'
import { executeOciEventsOperation } from '@/lib/internal/oci-events/operations'

const connection = { oauthCredential: 'credential' }
const summary = {
  id: 'rule/one',
  displayName: 'Bucket changes',
  compartmentId: 'compartment',
  condition: '{"eventType":"com.oraclecloud.objectstorage.createbucket"}',
  isEnabled: false,
  lifecycleState: 'ACTIVE',
  timeCreated: '2026-09-05T12:00:00Z',
}
const action = { actionType: 'ONS', isEnabled: false, topicId: 'topic' }
const rule = {
  ...summary,
  lifecycleMessage: null,
  actions: {
    actions: [{ ...action, id: 'action', lifecycleState: 'ACTIVE', lifecycleMessage: null }],
  },
}
const create = {
  compartmentId: 'compartment',
  displayName: summary.displayName,
  isEnabled: false,
  condition: { eventType: 'com.oraclecloud.objectstorage.createbucket' },
  actions: [action],
}
const request = vi.fn()
const prepare = vi.fn()
const client: OciClient = {
  prepareStaticEndpoint: prepare,
  prepareDiscoveredEndpoint: vi.fn(),
  request,
}

function respond(data: unknown, status = 200) {
  request.mockResolvedValue({
    status,
    body: status === 204 ? new Uint8Array() : new TextEncoder().encode(JSON.stringify(data)),
    headers: { etag: '"version-1"', 'opc-next-page': 'next+/=' },
    opcRequestId: 'oci-request',
  })
}

const cases: [OciEventsOperation, Record<string, unknown>, string, string, unknown][] = [
  ['list_rules', { compartmentId: 'compartment' }, 'GET', '/rules', [summary]],
  ['get_rule', { ruleId: ' rule/one ' }, 'GET', '/rules/rule%2Fone', rule],
  ['create_rule', create, 'POST', '/rules', rule],
  ['update_rule', { ruleId: 'rule/one', isEnabled: false }, 'PUT', '/rules/rule%2Fone', rule],
  ['delete_rule', { ruleId: 'rule/one' }, 'DELETE', '/rules/rule%2Fone', undefined],
  [
    'change_rule_compartment',
    { ruleId: 'rule/one', destinationCompartmentId: 'destination' },
    'POST',
    '/rules/rule%2Fone/actions/changeCompartment',
    undefined,
  ],
]

describe('OCI Events operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prepare.mockResolvedValue({ bound: true })
  })

  it.each(cases)(
    'constructs the documented %s request',
    async (operation, fields, method, path, data) => {
      respond(data, data === undefined ? 204 : 200)
      const input = ociEventsInputSchemas[operation].parse({ ...connection, ...fields })
      const result = await executeOciEventsOperation(client, operation, input)
      expect(prepare).toHaveBeenCalledWith(
        expect.objectContaining({ serviceId: 'oci_events', serviceName: 'events' })
      )
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          method,
          encodedPath: `/20181201${path}`,
          timeoutMs: 60_000,
          maxResponseBytes: 8 * 1024 * 1024,
          responseHeaders: ['opc-next-page', 'etag'],
        })
      )
      expect(result.output).toMatchObject({
        status: data === undefined ? 204 : 200,
        opcRequestId: 'oci-request',
      })
      if (data === undefined) {
        expect(result.output).toEqual({ status: 204, opcRequestId: 'oci-request' })
      }
      if (method === 'GET' || method === 'DELETE') {
        expect(request.mock.calls[0][0]).not.toHaveProperty('body')
      }
    }
  )

  it('serializes the condition exactly once and wraps typed action configurations', async () => {
    respond(rule)
    const input = ociEventsInputSchemas.create_rule.parse({
      ...connection,
      ...create,
      condition: JSON.stringify(create.condition),
      actions: JSON.stringify([action, { actionType: 'FAAS', isEnabled: true, functionId: 'fn' }]),
      opcRetryToken: 'stable-token',
      opcRequestId: 'caller-request',
    })
    await executeOciEventsOperation(client, 'create_rule', input)
    const sent = request.mock.calls[0][0] as OciRequest
    expect(JSON.parse(new TextDecoder().decode(sent.body))).toEqual({
      ...create,
      condition: JSON.stringify(create.condition),
      actions: { actions: [action, { actionType: 'FAAS', isEnabled: true, functionId: 'fn' }] },
    })
    expect(sent.headers).toEqual({ 'opc-request-id': 'caller-request' })
    expect(sent.retry).toEqual({ kind: 'tokenized', retryToken: 'stable-token', maxAttempts: 3 })
    expect(sent.contentType).toBe('application/json')
  })

  it('preserves false and explicit clears without merging or retrying updates', async () => {
    respond(rule)
    const input = ociEventsInputSchemas.update_rule.parse({
      ...connection,
      ruleId: 'rule',
      description: '',
      isEnabled: false,
      condition: {},
      freeformTags: {},
      definedTags: {},
      ifMatch: '"etag"',
    })
    await executeOciEventsOperation(client, 'update_rule', input)
    const sent = request.mock.calls[0][0] as OciRequest
    expect(JSON.parse(new TextDecoder().decode(sent.body))).toEqual({
      description: '',
      isEnabled: false,
      condition: '{}',
      freeformTags: {},
      definedTags: {},
    })
    expect(sent.headers).toEqual({ 'if-match': '"etag"' })
    expect(sent.retry).toBeUndefined()
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('moves using only the destination body and documented headers', async () => {
    respond(undefined, 204)
    const input = ociEventsInputSchemas.change_rule_compartment.parse({
      ...connection,
      ruleId: 'rule',
      compartmentId: 'source',
      destinationCompartmentId: 'destination',
      ifMatch: 'etag',
      opcRetryToken: 'move-token',
    })
    await executeOciEventsOperation(client, 'change_rule_compartment', input)
    const sent = request.mock.calls[0][0] as OciRequest
    expect(JSON.parse(new TextDecoder().decode(sent.body))).toEqual({
      compartmentId: 'destination',
    })
    expect(sent.headers).toEqual({ 'if-match': 'etag' })
    expect(sent.retry).toEqual({ kind: 'tokenized', retryToken: 'move-token', maxAttempts: 3 })
  })

  it('forwards exact filters and returns a cursor even for an empty page', async () => {
    respond([])
    const fields = {
      compartmentId: 'compartment',
      limit: 50,
      page: 'opaque+/=',
      displayName: 'Name',
      lifecycleState: 'INACTIVE',
      sortBy: 'TIME_CREATED',
      sortOrder: 'DESC',
    }
    const input = ociEventsInputSchemas.list_rules.parse({ ...connection, ...fields })
    const result = await executeOciEventsOperation(client, 'list_rules', input)
    expect(Object.fromEntries(request.mock.calls[0][0].queryPairs)).toEqual({
      ...fields,
      limit: '50',
    })
    expect(result.output).toMatchObject({ rules: [], nextPage: 'next+/=' })
  })

  it('projects summaries without inventing actions and full rules with nullable messages', async () => {
    respond([{ ...summary, unexpected: 'omit', actions: rule.actions }])
    const list = await executeOciEventsOperation(
      client,
      'list_rules',
      ociEventsInputSchemas.list_rules.parse({ ...connection, compartmentId: 'compartment' })
    )
    expect(list.output.rules).toEqual([summary])
    respond({ ...rule, unexpected: 'omit' })
    const get = await executeOciEventsOperation(
      client,
      'get_rule',
      ociEventsInputSchemas.get_rule.parse({ ...connection, ruleId: 'rule' })
    )
    expect(get.output.rule).toEqual(rule)
    expect(get.output.etag).toBe('"version-1"')
  })

  it('rejects oversized request bodies before endpoint preparation', async () => {
    const input = ociEventsInputSchemas.create_rule.parse({
      ...connection,
      ...create,
      condition: { data: { additionalDetails: '"'.repeat(600_000) } },
    })
    await expect(executeOciEventsOperation(client, 'create_rule', input)).rejects.toThrow('1 MiB')
    expect(prepare).not.toHaveBeenCalled()
  })

  it('propagates ETag failures and deletion 404 instead of pretending success', async () => {
    for (const [operation, status] of [
      ['update_rule', 412],
      ['delete_rule', 404],
    ] as const) {
      const error = new OciClientError('request_failed', { status })
      request.mockRejectedValueOnce(error)
      const input = ociEventsInputSchemas[operation].parse({
        ...connection,
        ruleId: 'rule',
        isEnabled: false,
        ifMatch: 'etag',
      })
      await expect(executeOciEventsOperation(client, operation, input)).rejects.toBe(error)
    }
  })

  it('forwards cancellation and stops when cancelled during preparation', async () => {
    const controller = new AbortController()
    const input = ociEventsInputSchemas.get_rule.parse({ ...connection, ruleId: 'rule' })
    respond(rule)
    await executeOciEventsOperation(client, 'get_rule', input, controller.signal)
    expect(request.mock.calls[0][0].signal).toBe(controller.signal)
    prepare.mockImplementationOnce(() => {
      controller.abort()
      return {}
    })
    await expect(
      executeOciEventsOperation(client, 'get_rule', input, controller.signal)
    ).rejects.toThrow()
    expect(request).toHaveBeenCalledTimes(1)
  })
})

describe('OCI Events validation', () => {
  it.each(['{', 'null', '[]', 'true', '"text"', '', { eventType: 4 }, { data: [] }])(
    'rejects malformed or non-object conditions: %j',
    (condition) => {
      const result = ociEventsInputSchemas.create_rule.safeParse({
        ...connection,
        ...create,
        condition,
      })
      expect(result.success).toBe(false)
    }
  )

  it.each(
    [
      [],
      Array.from({ length: 11 }, () => action),
      [{ actionType: 'ONS', isEnabled: true }],
      [{ ...action, functionId: 'wrong' }],
      [{ ...action, id: 'response-only' }],
      [{ ...action, lifecycleState: 'ACTIVE' }],
      [{ ...action, actionType: 'HTTP' }],
      [{ actionType: 'FAAS', isEnabled: true }],
      [{ actionType: 'OSS', isEnabled: true }],
    ].map((actions) => [actions])
  )('rejects invalid action configurations: %j', (actions) => {
    const result = ociEventsInputSchemas.create_rule.safeParse({
      ...connection,
      ...create,
      actions,
    })
    expect(result.success).toBe(false)
  })

  it('accepts nested conditions, all target types, and explicit match-all', () => {
    for (const condition of [
      {},
      { eventType: ['one', 'two'], data: { freeFormTags: { Team: 'ops*' } } },
    ]) {
      const result = ociEventsInputSchemas.create_rule.parse({
        ...connection,
        ...create,
        condition,
        actions: [
          action,
          { actionType: 'FAAS', isEnabled: false, functionId: 'fn' },
          { actionType: 'OSS', isEnabled: true, streamId: 'stream' },
        ],
      })
      expect(result.condition).toEqual(condition)
    }
  })

  it('rejects empty updates and enforces pagination and retry-token bounds', () => {
    const emptyUpdate = ociEventsInputSchemas.update_rule.safeParse({
      ...connection,
      ruleId: 'rule',
    })
    expect(emptyUpdate.success).toBe(false)
    for (const limit of [0, 51, 1.5]) {
      const result = ociEventsInputSchemas.list_rules.safeParse({
        ...connection,
        compartmentId: 'c',
        limit,
      })
      expect(result.success).toBe(false)
    }
    const retryToken = ociEventsInputSchemas.create_rule.safeParse({
      ...connection,
      ...create,
      opcRetryToken: 'x'.repeat(65),
    })
    expect(retryToken.success).toBe(false)
  })

  it('rejects oversized, deeply nested and cyclic resolved JSON before schema recursion', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    let deep: Record<string, unknown> = {}
    for (let level = 0; level < 40; level++) deep = { child: deep }
    const wide = Object.fromEntries(Array.from({ length: 10_001 }, (_, i) => [`key${i}`, 0]))
    for (const condition of [
      { data: { value: 'x'.repeat(1024 * 1024 + 1) } },
      { data: { value: 'λ'.repeat(600_000) } },
      deep,
      cyclic,
      wide,
      JSON.stringify(deep),
    ]) {
      const result = ociEventsInputSchemas.create_rule.safeParse({
        ...connection,
        ...create,
        condition,
      })
      expect(result.success).toBe(false)
    }
    const tags = ociEventsInputSchemas.update_rule.safeParse({
      ...connection,
      ruleId: 'rule',
      freeformTags: { value: 'x'.repeat(1024 * 1024 + 1) },
    })
    expect(tags.success).toBe(false)
  })
})
