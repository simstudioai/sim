/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'

const fileMocks = vi.hoisted(() => ({
  assertToolFileAccess: vi.fn(),
  downloadServableFileFromStorage: vi.fn(),
  processFilesToUserFiles: vi.fn(),
}))

vi.mock('@/app/api/files/authorization', () => ({
  assertToolFileAccess: fileMocks.assertToolFileAccess,
}))
vi.mock('@/lib/uploads/utils/file-utils', () => ({
  processFilesToUserFiles: fileMocks.processFilesToUserFiles,
}))
vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadServableFileFromStorage: fileMocks.downloadServableFileFromStorage,
}))

import { clearSailPointTokenStateForTests } from '@/lib/internal/sailpoint/client'
import { executeSailPointTool } from '@/lib/internal/sailpoint/execute-tool'
import { MAX_SAILPOINT_CSV_BYTES } from '@/lib/internal/sailpoint/operations'

const mockFetch = vi.fn<typeof fetch>()
const credentials = { clientId: 'client', clientSecret: 'secret', tenant: 'acme' }

function tokenResponse(): Response {
  return Response.json({ access_token: 'token', expires_in: 3600 })
}

function request(operation: string, input: Record<string, unknown>, userId?: string) {
  return executeSailPointTool({
    toolId: operation,
    input: { ...credentials, operation, ...input },
    headers: new Headers(),
    context: { workflowId: 'workflow', userId },
    requestId: 'request-id',
  })
}

interface OperationCase {
  body?: unknown
  input: Record<string, unknown>
  method: 'GET' | 'POST'
  operation: string
  path: string
  providerBody?: unknown
  providerStatus?: number
  total?: number
}

const OPERATION_CASES: OperationCase[] = [
  {
    operation: 'sailpoint_search',
    method: 'POST',
    path: '/search/v1',
    input: { indices: ['identities'], query: { query: 'name:a*' } },
    body: { indices: ['identities'], query: { query: 'name:a*' } },
    providerBody: [],
  },
  {
    operation: 'sailpoint_search_count',
    method: 'POST',
    path: '/search/v1/count',
    input: { queryType: 'DSL', queryDsl: { match_all: {} } },
    body: { queryType: 'DSL', queryDsl: { match_all: {} } },
    providerStatus: 204,
    total: 7,
  },
  {
    operation: 'sailpoint_search_aggregate',
    method: 'POST',
    path: '/search/v1/aggregate?count=true',
    input: { aggregationsDsl: { names: { terms: { field: 'name' } } }, count: true },
    body: {
      aggregationType: 'DSL',
      aggregationsDsl: { names: { terms: { field: 'name' } } },
    },
    providerBody: { aggregations: { names: { buckets: [] } }, hits: [] },
    total: 3,
  },
  {
    operation: 'sailpoint_list_identities',
    method: 'GET',
    path: '/identities/v1',
    input: {},
    providerBody: [],
  },
  {
    operation: 'sailpoint_get_identity',
    method: 'GET',
    path: '/identities/v1/id',
    input: { id: 'id' },
  },
  {
    operation: 'sailpoint_list_identity_entitlements',
    method: 'GET',
    path: '/entitlements/v1/identities/id/entitlements',
    input: { id: 'id' },
    providerBody: [],
  },
  {
    operation: 'sailpoint_list_accounts',
    method: 'GET',
    path: '/accounts/v1',
    input: {},
    providerBody: [],
  },
  {
    operation: 'sailpoint_get_account',
    method: 'GET',
    path: '/accounts/v1/id',
    input: { id: 'id' },
  },
  {
    operation: 'sailpoint_get_account_entitlements',
    method: 'GET',
    path: '/accounts/v1/id/entitlements',
    input: { id: 'id' },
    providerBody: [],
  },
  {
    operation: 'sailpoint_list_entitlements',
    method: 'GET',
    path: '/entitlements/v1',
    input: {},
    providerBody: [],
  },
  {
    operation: 'sailpoint_get_entitlement',
    method: 'GET',
    path: '/entitlements/v1/id',
    input: { id: 'id' },
  },
  {
    operation: 'sailpoint_get_entitlement_request_config',
    method: 'GET',
    path: '/entitlements/v1/id/entitlement-request-config',
    input: { id: 'id' },
  },
  {
    operation: 'sailpoint_list_roles',
    method: 'GET',
    path: '/roles/v1',
    input: {},
    providerBody: [],
  },
  { operation: 'sailpoint_get_role', method: 'GET', path: '/roles/v1/id', input: { id: 'id' } },
  {
    operation: 'sailpoint_get_role_entitlements',
    method: 'GET',
    path: '/roles/v1/id/entitlements',
    input: { id: 'id' },
    providerBody: [],
  },
  {
    operation: 'sailpoint_list_access_profiles',
    method: 'GET',
    path: '/access-profiles/v1',
    input: {},
    providerBody: [],
  },
  {
    operation: 'sailpoint_get_access_profile',
    method: 'GET',
    path: '/access-profiles/v1/id',
    input: { id: 'id' },
  },
  {
    operation: 'sailpoint_get_access_profile_entitlements',
    method: 'GET',
    path: '/access-profiles/v1/id/entitlements',
    input: { id: 'id' },
    providerBody: [],
  },
  {
    operation: 'sailpoint_list_sources',
    method: 'GET',
    path: '/sources/v1',
    input: {},
    providerBody: [],
  },
  { operation: 'sailpoint_get_source', method: 'GET', path: '/sources/v1/id', input: { id: 'id' } },
  {
    operation: 'sailpoint_list_account_activities',
    method: 'GET',
    path: '/account-activities/v1',
    input: {},
    providerBody: [],
  },
  {
    operation: 'sailpoint_get_account_activity',
    method: 'GET',
    path: '/account-activities/v1/id',
    input: { id: 'id' },
  },
  {
    operation: 'sailpoint_list_campaigns',
    method: 'GET',
    path: '/campaigns/v1',
    input: {},
    providerBody: [],
  },
  {
    operation: 'sailpoint_get_campaign',
    method: 'GET',
    path: '/campaigns/v1/id',
    input: { id: 'id' },
  },
  {
    operation: 'sailpoint_list_certifications',
    method: 'GET',
    path: '/certifications/v1',
    input: {},
    providerBody: [],
  },
  {
    operation: 'sailpoint_get_certification',
    method: 'GET',
    path: '/certifications/v1/id',
    input: { id: 'id' },
  },
  {
    operation: 'sailpoint_list_certification_review_items',
    method: 'GET',
    path: '/certifications/v1/id/access-review-items',
    input: { id: 'id' },
    providerBody: [],
  },
  {
    operation: 'sailpoint_decide_certification_review_items',
    method: 'POST',
    path: '/certifications/v1/id/decide',
    input: { id: 'id', decisions: [{ id: 'review', decision: 'APPROVE', bulk: true }] },
    body: [{ id: 'review', decision: 'APPROVE', bulk: true }],
  },
  {
    operation: 'sailpoint_sign_off_certification',
    method: 'POST',
    path: '/certifications/v1/id/sign-off',
    input: { id: 'id' },
  },
  {
    operation: 'sailpoint_request_access',
    method: 'POST',
    path: '/access-requests/v1',
    input: { requestedFor: ['identity'], requestedItems: [{ type: 'ROLE', id: 'role' }] },
    body: { requestedFor: ['identity'], requestedItems: [{ type: 'ROLE', id: 'role' }] },
    providerStatus: 202,
    providerBody: { newRequests: [], existingRequests: [] },
  },
  {
    operation: 'sailpoint_get_account_selections',
    method: 'POST',
    path: '/access-requests/v1/accounts-selection',
    input: { requestedFor: ['identity'], requestedItems: [{ type: 'ROLE', id: 'role' }] },
    body: { requestedFor: ['identity'], requestedItems: [{ type: 'ROLE', id: 'role' }] },
  },
  {
    operation: 'sailpoint_get_access_request_config',
    method: 'GET',
    path: '/access-request-config/v2',
    input: {},
  },
  {
    operation: 'sailpoint_cancel_access_request',
    method: 'POST',
    path: '/access-requests/v1/cancel',
    input: { accountActivityId: 'activity', comment: 'cancel' },
    body: { accountActivityId: 'activity', comment: 'cancel' },
    providerStatus: 202,
  },
  {
    operation: 'sailpoint_get_access_request_status',
    method: 'GET',
    path: '/access-request-status/v1',
    input: {},
    providerBody: [],
  },
  {
    operation: 'sailpoint_list_pending_access_request_approvals',
    method: 'GET',
    path: '/access-request-approvals/v1/pending',
    input: {},
    providerBody: [],
  },
  {
    operation: 'sailpoint_approve_access_request',
    method: 'POST',
    path: '/access-request-approvals/v1/approval/approve',
    input: { approvalId: 'approval' },
    providerStatus: 202,
  },
  {
    operation: 'sailpoint_reject_access_request',
    method: 'POST',
    path: '/access-request-approvals/v1/approval/reject',
    input: { approvalId: 'approval', comment: 'reject' },
    body: { comment: 'reject' },
    providerStatus: 202,
  },
  {
    operation: 'sailpoint_get_task_status',
    method: 'GET',
    path: '/task-status/v1/id',
    input: { id: 'id' },
  },
]

describe('SailPoint internal tool handler', () => {
  beforeEach(() => {
    clearSailPointTokenStateForTests()
    mockFetch.mockReset()
    vi.stubGlobal('fetch', mockFetch)
    fileMocks.assertToolFileAccess.mockReset().mockResolvedValue(null)
    fileMocks.processFilesToUserFiles.mockReset()
    fileMocks.downloadServableFileFromStorage.mockReset()
  })

  it.each(OPERATION_CASES)(
    'uses the documented path and method for $operation',
    async (testCase) => {
      const headers =
        testCase.total === undefined ? undefined : { 'x-total-count': String(testCase.total) }
      const status = testCase.providerStatus ?? 200
      const providerResponse =
        status === 204
          ? new Response(null, { status, headers })
          : Response.json(testCase.providerBody ?? { id: 'resource' }, { status, headers })
      mockFetch.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(providerResponse)

      const response = await request(testCase.operation, testCase.input)
      expect(response.status).toBe(200)
      const providerCall = mockFetch.mock.calls[1]
      expect(
        new URL(String(providerCall[0])).pathname + new URL(String(providerCall[0])).search
      ).toBe(testCase.path)
      const init = providerCall[1]
      expect(init?.method).toBe(testCase.method)
      if (testCase.body !== undefined) {
        expect(JSON.parse(String(init?.body))).toEqual(testCase.body)
      }
    }
  )

  it('sends the experimental header for account-selection discovery', async () => {
    mockFetch
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(Response.json({ accountsSelections: [] }))
    const response = await request('sailpoint_get_account_selections', {
      requestedFor: ['identity'],
      requestedItems: [{ type: 'ROLE', id: 'role' }],
    })

    expect(response.status).toBe(200)
    const headers = new Headers(mockFetch.mock.calls[1][1]?.headers)
    expect(headers.get('x-sailpoint-experimental')).toBe('true')
  })

  it.each([
    ['sailpoint_get_account_selections', 'accountSelections', { accountsSelections: [] }],
    ['sailpoint_get_access_request_config', 'accessRequestConfig', { accessRequest: {} }],
    [
      'sailpoint_get_entitlement_request_config',
      'entitlementRequestConfig',
      { grantRequestConfig: {} },
    ],
  ])('maps %s to its resource-named output', async (operation, outputKey, providerBody) => {
    clearSailPointTokenStateForTests()
    mockFetch.mockReset()
    mockFetch
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(Response.json(providerBody))
    const input =
      operation === 'sailpoint_get_account_selections'
        ? { requestedFor: ['identity'], requestedItems: [{ type: 'ROLE', id: 'role' }] }
        : operation === 'sailpoint_get_entitlement_request_config'
          ? { id: 'entitlement' }
          : {}

    const response = await request(operation, input)
    await expect(response.json()).resolves.toEqual({
      success: true,
      output: { [outputKey]: providerBody },
    })
  })

  it('rejects a primitive resource response', async () => {
    mockFetch
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(Response.json('not-a-resource'))
    const response = await request('sailpoint_get_access_request_config', {})

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: 'SailPoint returned an invalid resource response',
    })
  })

  it('preserves access-request tracking and accepted status', async () => {
    const tracking = {
      newRequests: [{ requestedFor: 'identity', accessRequestIds: ['new'] }],
      existingRequests: [{ requestedFor: 'identity', accessRequestIds: ['existing'] }],
    }
    mockFetch
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(Response.json(tracking, { status: 202 }))
    const response = await request('sailpoint_request_access', {
      requestedFor: ['identity'],
      requestedItems: [{ type: 'ROLE', id: 'role' }],
    })
    const body = await response.json()
    expect(body.output).toEqual({ accepted: true, status: 202, ...tracking })
  })

  it.each([
    { newRequests: 'invalid', existingRequests: [] },
    { newRequests: [], existingRequests: { id: 'invalid' } },
  ])('rejects malformed access-request tracking arrays', async (tracking) => {
    mockFetch
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(Response.json(tracking, { status: 202 }))
    const response = await request('sailpoint_request_access', {
      requestedFor: ['identity'],
      requestedItems: [{ type: 'ROLE', id: 'role' }],
    })

    expect(response.status).toBe(502)
  })

  it('forwards every advanced Search body field without inventing default indices', async () => {
    const input = {
      queryType: 'DSL',
      queryVersion: '7.10',
      query: { query: 'name:a*', fields: 'name', timeZone: 'UTC', innerHit: { type: 'access' } },
      queryDsl: { match_all: {} },
      textQuery: { terms: ['alice'], fields: ['name'], matchAny: true, contains: false },
      typeAheadQuery: {
        query: 'Ali',
        field: 'name',
        nestedType: 'access',
        maxExpansions: 20,
        size: 5,
        sort: 'asc',
        sortByValue: true,
      },
      includeNested: false,
      queryResultFilter: { includes: ['name'], excludes: ['stacktrace'] },
      aggregationType: 'DSL',
      aggregationsVersion: '7.10',
      aggregationsDsl: { names: { terms: { field: 'name' } } },
      sort: ['name', '+id'],
      searchAfter: ['Alice', 'id'],
      filters: { status: { terms: ['ACTIVE'], exclude: false } },
      limit: 25,
      offset: 5,
      count: true,
    }
    mockFetch
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(Response.json([], { headers: { 'x-total-count': '1' } }))
    const response = await request('sailpoint_search', input)
    expect(response.status).toBe(200)
    const [url, init] = mockFetch.mock.calls[1]
    expect(String(url)).toMatch(/\/search\/v1\?limit=25&offset=5&count=true$/)
    expect(JSON.parse(String(init?.body))).toEqual({
      queryType: input.queryType,
      queryVersion: input.queryVersion,
      query: input.query,
      queryDsl: input.queryDsl,
      textQuery: input.textQuery,
      typeAheadQuery: input.typeAheadQuery,
      includeNested: input.includeNested,
      queryResultFilter: input.queryResultFilter,
      aggregationType: input.aggregationType,
      aggregationsVersion: input.aggregationsVersion,
      aggregationsDsl: input.aggregationsDsl,
      sort: input.sort,
      searchAfter: input.searchAfter,
      filters: input.filters,
    })
    expect(JSON.parse(String(init?.body))).not.toHaveProperty('indices')
  })

  it.each(['sailpoint_search', 'sailpoint_search_count'])(
    'requires a query for the default SAILPOINT mode in %s',
    async (operation) => {
      const response = await request(operation, {})
      expect(response.status).toBe(400)
      expect(mockFetch).not.toHaveBeenCalled()
    }
  )

  it('requires queryType=DSL when queryDsl is used', async () => {
    const response = await request('sailpoint_search', { queryDsl: { match_all: {} } })
    expect(response.status).toBe(400)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it.each([
    ['aggregationsDsl', {}],
    ['aggregationsDsl', '{}'],
    ['aggregations', {}],
    ['aggregations', '{}'],
  ])('rejects an empty %s aggregate definition', async (field, value) => {
    const response = await request('sailpoint_search_aggregate', { [field]: value })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining('must be a non-empty object'),
    })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it.each([
    [
      'sailpoint_list_entitlements',
      {
        segmentedForIdentity: 'identity',
        forSegmentIds: 'segment-a,segment-b',
        includeUnsegmented: false,
        searchAfter: 'cursor',
        filters: 'name sw "A"',
        sorters: 'name',
        limit: 10,
        offset: 2,
        count: true,
      },
      '/entitlements/v1?filters=name+sw+%22A%22&sorters=name&segmented-for-identity=identity&for-segment-ids=segment-a%2Csegment-b&include-unsegmented=false&searchAfter=cursor&limit=10&offset=2&count=true',
    ],
    [
      'sailpoint_list_roles',
      { forSubadmin: 'me', forSegmentIds: 'segment', includeUnsegmented: false },
      '/roles/v1?for-subadmin=me&for-segment-ids=segment&include-unsegmented=false',
    ],
    [
      'sailpoint_list_access_profiles',
      { forSubadmin: 'me', forSegmentIds: 'segment', includeUnsegmented: false },
      '/access-profiles/v1?for-subadmin=me&for-segment-ids=segment&include-unsegmented=false',
    ],
  ])('forwards current collection parameters for %s', async (operation, input, path) => {
    mockFetch.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(Response.json([]))
    const response = await request(operation, input)
    expect(response.status).toBe(200)
    expect(
      new URL(String(mockFetch.mock.calls[1][0])).pathname +
        new URL(String(mockFetch.mock.calls[1][0])).search
    ).toBe(path)
  })

  it('rejects pairwise certification review selectors', async () => {
    const response = await request('sailpoint_list_certification_review_items', {
      id: 'certification',
      entitlements: 'entitlement',
      roles: 'role',
    })
    expect(response.status).toBe(400)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it.each(['sailpoint_list_account_activities', 'sailpoint_get_access_request_status'])(
    'rejects conflicting requested/regarding identity scopes for %s',
    async (operation) => {
      const response = await request(operation, {
        requestedFor: 'identity',
        regardingIdentity: 'identity',
      })
      expect(response.status).toBe(400)
      expect(mockFetch).not.toHaveBeenCalled()
    }
  )

  it('forwards the nested requestedForWithRequestedItems shape', async () => {
    const nested = [
      {
        identityId: 'identity',
        identityType: 'HUMAN',
        requestedItems: [
          {
            type: 'ENTITLEMENT',
            id: 'entitlement',
            accountSelection: [{ sourceId: 'source', accounts: [{ nativeIdentity: 'native-id' }] }],
          },
        ],
      },
    ]
    mockFetch
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(
        Response.json({ newRequests: [], existingRequests: [] }, { status: 202 })
      )
    const response = await request('sailpoint_request_access', {
      requestedForWithRequestedItems: nested,
    })
    expect(response.status).toBe(200)
    expect(JSON.parse(String(mockFetch.mock.calls[1][1]?.body))).toEqual({
      requestedForWithRequestedItems: nested,
    })
  })

  it('rejects an account selection without an account UUID or native identity', async () => {
    const response = await request('sailpoint_get_account_selections', {
      requestedForWithRequestedItems: [
        {
          identityId: 'machine',
          identityType: 'MACHINE',
          requestedItems: [
            {
              type: 'ENTITLEMENT',
              id: 'entitlement',
              accountSelection: [{ sourceId: 'source', accounts: [{}] }],
            },
          ],
        },
      ],
    })

    expect(response.status).toBe(400)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it.each(['sailpoint_request_access', 'sailpoint_get_account_selections'])(
    'enforces the recipient cap for entitlement inputs at the %s handler boundary',
    async (operation) => {
      const response = await request(operation, {
        requestType: 'MODIFY_ACCESS',
        requestedFor: Array.from({ length: 11 }, (_, index) => `identity-${index}`),
        requestedItems: [{ type: 'ENTITLEMENT', id: 'entitlement' }],
      })

      expect(response.status).toBe(400)
      expect(mockFetch).not.toHaveBeenCalled()
    }
  )

  it.each(['sailpoint_request_access', 'sailpoint_get_account_selections'])(
    'enforces the nested entitlement cap at the %s handler boundary',
    async (operation) => {
      const response = await request(operation, {
        requestType: 'MODIFY_ACCESS',
        requestedForWithRequestedItems: [
          {
            identityId: 'identity',
            identityType: 'HUMAN',
            requestedItems: Array.from({ length: 26 }, (_, index) => ({
              type: 'ENTITLEMENT',
              id: `entitlement-${index}`,
            })),
          },
        ],
      })

      expect(response.status).toBe(400)
      expect(mockFetch).not.toHaveBeenCalled()
    }
  )

  it('accepts multiple role revokes but rejects multiple entitlement revokes', async () => {
    mockFetch
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(
        Response.json({ newRequests: [], existingRequests: [] }, { status: 202 })
      )
    const accepted = await request('sailpoint_request_access', {
      requestType: 'REVOKE_ACCESS',
      requestedFor: ['identity'],
      requestedItems: [
        { type: 'ROLE', id: 'one', comment: 'remove' },
        { type: 'ROLE', id: 'two', comment: 'remove' },
      ],
    })
    expect(accepted.status).toBe(200)

    clearSailPointTokenStateForTests()
    mockFetch.mockReset()
    const rejected = await request('sailpoint_request_access', {
      requestType: 'REVOKE_ACCESS',
      requestedFor: ['identity'],
      requestedItems: [
        { type: 'ENTITLEMENT', id: 'one', comment: 'remove' },
        { type: 'ENTITLEMENT', id: 'two', comment: 'remove' },
      ],
    })
    expect(rejected.status).toBe(400)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('maps resource reads to their resource-named output', async () => {
    mockFetch
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(Response.json({ id: 'identity' }))
    const response = await request('sailpoint_get_identity', { id: 'identity' })
    await expect(response.json()).resolves.toEqual({
      success: true,
      output: { identity: { id: 'identity' } },
    })
  })

  it('rejects mismatched tool and input operation before making a provider call', async () => {
    const response = await executeSailPointTool({
      toolId: 'sailpoint_get_identity',
      input: { ...credentials, operation: 'sailpoint_get_account', id: 'id' },
      headers: new Headers(),
      context: { workflowId: 'workflow' },
      requestId: 'request-id',
    })
    expect(response.status).toBe(400)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it.each([
    ['sailpoint_load_accounts', '/sources/v1/source/load-accounts'],
    ['sailpoint_load_entitlements', '/sources/v1/source/load-entitlements'],
  ])('authorizes and bounds the CSV for %s', async (operation, path) => {
    fileMocks.processFilesToUserFiles.mockReturnValue([
      { key: 'workspace/file.csv', name: 'file.csv', type: 'text/csv' },
    ])
    fileMocks.downloadServableFileFromStorage.mockResolvedValue({
      buffer: Buffer.from('id,name'),
      contentType: 'text/csv',
    })
    const providerBody =
      operation === 'sailpoint_load_accounts'
        ? { success: true, task: { id: 'task' } }
        : { id: 'task', uniqueName: 'aggregation' }
    mockFetch
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(Response.json(providerBody, { status: 202 }))

    const response = await request(
      operation,
      { sourceId: 'source', file: { key: 'file', name: 'file.csv', size: 7 } },
      'user'
    )
    expect(response.status).toBe(200)
    const envelope = await response.clone().json()
    if (operation === 'sailpoint_load_accounts') {
      expect(envelope.output).toEqual({ success: true, task: { id: 'task' } })
    } else {
      expect(envelope.output).toEqual({ task: providerBody })
    }
    expect(fileMocks.assertToolFileAccess).toHaveBeenCalledWith(
      'workspace/file.csv',
      'user',
      'request-id',
      expect.anything()
    )
    expect(fileMocks.downloadServableFileFromStorage).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'workspace/file.csv' }),
      'request-id',
      expect.anything(),
      { maxBytes: MAX_SAILPOINT_CSV_BYTES, signal: undefined }
    )
    expect(new URL(String(mockFetch.mock.calls[1][0])).pathname).toBe(path)
  })

  it('parses a serialized file descriptor and preserves an empty selected CSV', async () => {
    fileMocks.processFilesToUserFiles.mockReturnValue([
      { key: 'workspace/empty.csv', name: 'empty.csv', type: 'text/csv' },
    ])
    fileMocks.downloadServableFileFromStorage.mockResolvedValue({
      buffer: Buffer.alloc(0),
      contentType: 'text/csv',
    })
    mockFetch
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(
        Response.json({ success: true, task: { id: 'task' } }, { status: 202 })
      )
    const serializedFile = JSON.stringify({ key: 'empty', name: 'empty.csv', size: 0 })

    const response = await request(
      'sailpoint_load_accounts',
      { sourceId: 'source', file: serializedFile },
      'user'
    )

    expect(response.status).toBe(200)
    expect(fileMocks.processFilesToUserFiles).toHaveBeenCalledWith(
      [{ key: 'empty', name: 'empty.csv', size: 0 }],
      'request-id',
      expect.anything()
    )
    const form = mockFetch.mock.calls[1][1]?.body as FormData
    const uploaded = form.get('file')
    expect(uploaded).toBeInstanceOf(Blob)
    expect((uploaded as Blob).size).toBe(0)
  })

  it('maps an oversized stored CSV to a bounded validation error', async () => {
    fileMocks.processFilesToUserFiles.mockReturnValue([
      { key: 'workspace/file.csv', name: 'file.csv', type: 'text/csv' },
    ])
    fileMocks.downloadServableFileFromStorage.mockRejectedValue(
      new PayloadSizeLimitError({
        label: 'SailPoint CSV',
        maxBytes: MAX_SAILPOINT_CSV_BYTES,
        observedBytes: MAX_SAILPOINT_CSV_BYTES + 1,
      })
    )
    const response = await request(
      'sailpoint_load_accounts',
      { sourceId: 'source', file: { key: 'file', name: 'file.csv', size: 7 } },
      'user'
    )
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: 'SailPoint CSV file exceeds the 25 MiB limit',
    })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('allows actorless provider calls but rejects stored-file loads without an actor', async () => {
    mockFetch
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(Response.json({ id: 'identity' }))
    const providerResponse = await request('sailpoint_get_identity', { id: 'identity' })
    expect(providerResponse.status).toBe(200)

    clearSailPointTokenStateForTests()
    mockFetch.mockReset()
    const fileResponse = await request('sailpoint_load_accounts', {
      sourceId: 'source',
      file: { key: 'file', name: 'file.csv', size: 7 },
    })
    expect(fileResponse.status).toBe(401)
    expect(fileMocks.processFilesToUserFiles).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
