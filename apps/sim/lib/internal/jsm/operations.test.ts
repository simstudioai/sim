import { getMockLogger } from '@sim/testing/mocks/logger.mock'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const client = {
    service: vi.fn((path: string) => `service:${path}`),
    forms: vi.fn((path: string) => `forms:${path}`),
    assets: vi.fn((path: string) => `assets:${path}`),
    json: vi.fn(),
    value: vi.fn(),
    empty: vi.fn(),
    optionalJson: vi.fn(),
  }
  return {
    client,
    createJsmClient: vi.fn(async () => client),
    createJsmAssetsClient: vi.fn(async () => client),
    mapAssetObject: vi.fn((value: unknown) => value),
  }
})

vi.mock('@/lib/internal/jsm/client', () => ({
  nested: (value: unknown, ...keys: string[]) => {
    let current = value
    for (const key of keys) {
      current =
        current && typeof current === 'object' && !Array.isArray(current)
          ? (current as Record<string, unknown>)[key]
          : undefined
    }
    return current
  },
  createJsmClient: mocks.createJsmClient,
  createJsmAssetsClient: mocks.createJsmAssetsClient,
}))

vi.mock('@/tools/jsm/utils', () => ({ mapAssetObject: mocks.mapAssetObject }))

import { executeJsmListObjectTypes, executeJsmSearchObjectsAql } from '@/lib/internal/jsm/assets'
import { executeJsmCreateRequest, executeJsmGetRequests } from '@/lib/internal/jsm/service-desk'

const BASE = {
  domain: 'example.atlassian.net',
  accessToken: 'token',
  cloudId: '12345678-1234-1234-1234-123456789012',
}

describe('JSM operations', () => {
  it('keeps form answers separate from explicitly supplied request field values', async () => {
    mocks.client.json.mockResolvedValueOnce({ issueKey: 'HELP-1' })
    await executeJsmCreateRequest({
      ...BASE,
      serviceDeskId: '1',
      requestTypeId: '2',
      summary: 'Do not duplicate this linked form field',
      formAnswers: { q1: 'yes' },
      requestFieldValues: { customfield_1: 'safe' },
    })
    const init = mocks.client.json.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(String(init.body))).toEqual({
      serviceDeskId: '1',
      requestTypeId: '2',
      form: { answers: { q1: 'yes' } },
      requestFieldValues: { customfield_1: 'safe' },
    })
  })

  it('accepts the organization ownership filter with its organization ID', async () => {
    mocks.client.json.mockResolvedValueOnce({ values: [], size: 0, isLastPage: true })
    await executeJsmGetRequests({
      ...BASE,
      requestOwnership: 'ORGANIZATION',
      organizationId: '3',
    })
    expect(mocks.client.json.mock.calls.at(-1)?.[0]).toBe(
      'service:/request?requestOwnership=ORGANIZATION&organizationId=3'
    )
  })

  it('sends AQL paging as startAt/maxResults query params and reads the values page', async () => {
    const controller = new AbortController()
    mocks.client.json.mockResolvedValueOnce({
      startAt: 10,
      maxResults: 10,
      total: 11,
      isLast: 'true',
      values: [{ id: 'object-1' }],
    })
    const result = await executeJsmSearchObjectsAql(
      {
        ...BASE,
        qlQuery: 'objectType = Host',
        page: '2',
        resultsPerPage: '10',
        objectSchemaId: '6',
      },
      controller.signal
    )
    expect(mocks.createJsmAssetsClient).toHaveBeenCalledWith(
      expect.objectContaining({ qlQuery: 'objectType = Host' }),
      controller.signal
    )
    expect(mocks.client.json).toHaveBeenCalledWith(
      'assets:/object/aql?startAt=10&maxResults=10&includeAttributes=true',
      {
        method: 'POST',
        body: JSON.stringify({ qlQuery: '(objectType = Host) AND objectSchemaId = 6' }),
      },
      controller.signal,
      true
    )
    expect(result.output).toMatchObject({
      objects: [{ id: 'object-1' }],
      total: 11,
      pageNumber: 2,
      isLast: true,
    })
  })

  it('rejects a non-numeric AQL scope ID instead of splicing it into the query', async () => {
    await expect(
      executeJsmSearchObjectsAql({
        ...BASE,
        qlQuery: 'objectType = Host',
        objectTypeId: '1 OR objectType != Host',
      })
    ).rejects.toThrow('objectTypeId must be a numeric ID')
  })

  it('falls back to the flat object-types listing when the schema listing comes back empty', async () => {
    mocks.client.value.mockReset()
    mocks.client.value.mockResolvedValueOnce([]).mockResolvedValueOnce([
      { id: '1', name: 'Host', abstractObjectType: false },
      { id: '2', name: 'Base', abstractObjectType: true },
    ])
    const result = await executeJsmListObjectTypes({
      ...BASE,
      schemaId: '6',
      excludeAbstract: true,
    })
    expect(mocks.client.value.mock.calls.map((call) => call[0])).toEqual([
      'assets:/objectschema/6/objecttypes?excludeAbstract=true',
      'assets:/objectschema/6/objecttypes/flat',
    ])
    expect(result.output).toMatchObject({ objectTypes: [{ id: '1', name: 'Host' }], total: 1 })
  })

  it('keeps a non-empty schema listing without a second request', async () => {
    mocks.client.value.mockReset()
    mocks.client.value.mockResolvedValueOnce([{ id: '1', name: 'Host' }])
    const result = await executeJsmListObjectTypes({ ...BASE, schemaId: '6' })
    expect(mocks.client.value).toHaveBeenCalledTimes(1)
    expect(result.output).toMatchObject({ objectTypes: [{ id: '1', name: 'Host' }], total: 1 })
  })

  it('keeps a trailing AQL order by clause after the scope filter', async () => {
    mocks.client.json.mockResolvedValueOnce({ values: [], total: 0, isLast: 'true' })
    await executeJsmSearchObjectsAql({
      ...BASE,
      qlQuery: 'Name = "sort order by date" ORDER BY "Created Date" desc',
      objectSchemaId: '6',
    })
    expect(mocks.client.json.mock.calls.at(-1)?.[1]).toEqual({
      method: 'POST',
      body: JSON.stringify({
        qlQuery:
          '(Name = "sort order by date") AND objectSchemaId = 6 ORDER BY "Created Date" desc',
      }),
    })
  })

  it.each([
    [{ approvalStatus: 'MY_PENDING_APPROVAL', requestOwnership: 'OWNED_REQUESTS' }, 'APPROVER'],
    [{ organizationId: '3', requestOwnership: 'APPROVER' }, 'ORGANIZATION'],
  ])(
    'rejects %o, which Atlassian only accepts with requestOwnership %s',
    async (filters, owner) => {
      await expect(executeJsmGetRequests({ ...BASE, ...filters })).rejects.toThrow(owner)
    }
  )

  it('does not split an order by inside an escaped quote', async () => {
    mocks.client.json.mockResolvedValueOnce({ values: [], total: 0, isLast: 'true' })
    await executeJsmSearchObjectsAql({
      ...BASE,
      qlQuery: 'Name = "say \\" order by \\" x" order by Name',
      objectTypeId: '7',
    })
    expect(JSON.parse(String(mocks.client.json.mock.calls.at(-1)?.[1]?.body))).toEqual({
      qlQuery: '(Name = "say \\" order by \\" x") AND objectTypeId = 7 order by Name',
    })
  })

  it.each([
    ['order by Name', 'objectTypeId = 7 order by Name'],
    ['  ORDER BY "Created Date" desc', 'objectTypeId = 7 ORDER BY "Created Date" desc'],
    [
      'object having inboundReferences(objectType = Host order by Name)',
      '(object having inboundReferences(objectType = Host order by Name)) AND objectTypeId = 7',
    ],
    [
      'object having inboundReferences(objectType = Host order by Name) order by Key',
      '(object having inboundReferences(objectType = Host order by Name)) AND objectTypeId = 7 order by Key',
    ],
  ])('scopes the AQL query %j as %j', async (qlQuery, expected) => {
    mocks.client.json.mockResolvedValueOnce({ values: [], total: 0, isLast: 'true' })
    await executeJsmSearchObjectsAql({ ...BASE, qlQuery, objectTypeId: '7' })
    expect(JSON.parse(String(mocks.client.json.mock.calls.at(-1)?.[1]?.body))).toEqual({
      qlQuery: expected,
    })
  })

  it('returns the empty schema listing when the flat fallback fails', async () => {
    mocks.client.value.mockReset()
    mocks.client.value
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('Jira request failed with status 404'))
    const result = await executeJsmListObjectTypes({ ...BASE, schemaId: '6' })
    expect(result.output).toMatchObject({ objectTypes: [], total: 0 })
    expect(getMockLogger('JsmAssets').warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ schemaId: '6' })
    )
  })

  it('still propagates an abort from the flat fallback', async () => {
    const controller = new AbortController()
    mocks.client.value.mockReset()
    mocks.client.value.mockResolvedValueOnce([]).mockImplementationOnce(async () => {
      controller.abort()
      throw new DOMException('The operation was aborted.', 'AbortError')
    })
    await expect(
      executeJsmListObjectTypes({ ...BASE, schemaId: '6' }, controller.signal)
    ).rejects.toThrow('aborted')
  })
})
