/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), dns: vi.fn() }))
vi.mock('@/lib/core/security/input-validation.server', () => ({
  DEFAULT_MAX_RESPONSE_BYTES: 100 * 1024 * 1024,
  secureFetchWithPinnedIP: mocks.fetch,
  validateUrlWithDNS: mocks.dns,
}))

import { executeOracleEpmEdmTool } from '@/lib/internal/oracle-epm-enterprise-data-management/execute-tool'

const id = '11111111-1111-4111-8111-111111111111'
const auth = {
  oauthCredential: 'credential',
  accessToken: 'dTpw',
  instanceUrl: 'https://edm.example.com/gateway',
}
const view = { viewId: id, viewpointId: id }
const names = {
  applicationName: 'Planning',
  dimensionName: 'Account',
  fileName: 'account.csv',
  waitForCompletion: false,
}
const job = { links: [{ rel: 'results', href: `${auth.instanceUrl}/epm/rest/v1/jobRuns/${id}` }] }

async function call(action: string, input: Record<string, unknown> = {}, signal?: AbortSignal) {
  return executeOracleEpmEdmTool({
    toolId: `oracle_epm_edm_${action}`,
    input: { ...auth, operation: `oracle_epm_edm_${action}`, ...input },
    headers: new Headers(),
    context: { workflowId: id, workspaceId: id, executionId: id, userId: 'user' },
    requestId: 'execution-request',
    signal,
  })
}
interface WireCase {
  action: string
  input: Record<string, unknown>
  method: string
  route: string
  provider: unknown
  body?: Record<string, unknown>
  query?: Record<string, string>
  status?: number
}
const cases: WireCase[] = [
  {
    action: 'list_applications',
    input: { permission: 'owner' },
    method: 'GET',
    route: '/applications',
    query: { q: 'permission::owner' },
    provider: { items: [] },
  },
  {
    action: 'list_dimensions',
    input: { applicationId: id },
    method: 'GET',
    route: '/applications',
    query: { q: `id::${id}` },
    provider: { items: [{ id, name: 'Planning', dimensions: [{ id, name: 'Account' }] }] },
  },
  {
    action: 'list_views',
    input: { dimensionId: id },
    method: 'GET',
    route: '/views',
    query: { q: `dimension::${id}` },
    provider: { items: [] },
  },
  {
    action: 'list_viewpoints',
    input: { viewId: id, applicationId: id },
    method: 'GET',
    route: `/views/${id}/viewpoints`,
    query: { q: `application::${id}` },
    provider: { items: [] },
  },
  {
    action: 'list_node_types',
    input: view,
    method: 'GET',
    route: `/views/${id}/viewpoints`,
    provider: {
      items: [
        { id, name: 'Accounts', nodeTypeAssignments: [{ nodeTypeLink: { id, name: 'Account' } }] },
      ],
    },
  },
  {
    action: 'get_node_type',
    input: { ...view, nodeTypeId: id },
    method: 'GET',
    route: `/views/${id}/viewpoints`,
    provider: {
      items: [
        { id, name: 'Accounts', nodeTypeAssignments: [{ nodeTypeLink: { id, name: 'Account' } }] },
      ],
    },
  },
  {
    action: 'list_nodes',
    input: { ...view, scope: 'children', parentNodeId: id },
    method: 'GET',
    route: `/views/${id}/viewpoints/${id}/nodes`,
    query: { q: `childrenOfNode::${id}`, limit: '50', offset: '0', expand: 'propertyValues::none' },
    provider: { items: [], hasMore: false },
  },
  {
    action: 'get_node',
    input: { ...view, nodeId: id },
    method: 'GET',
    route: `/views/${id}/viewpoints/${id}/nodes/${id}`,
    provider: { id, name: 'Account' },
  },
  {
    action: 'get_node_at_location',
    input: { ...view, nodeId: id, location: `${id},${id}` },
    method: 'GET',
    route: `/views/${id}/viewpoints/${id}/nodes/${id}/locations/${id},${id}`,
    provider: { id, name: 'Account' },
  },
  {
    action: 'browse_hierarchy',
    input: view,
    method: 'GET',
    route: `/views/${id}/viewpoints/${id}/nodes`,
    query: { q: 'top', limit: '50', offset: '0', expand: 'propertyValues::none' },
    provider: { items: [], hasMore: false },
  },
  {
    action: 'create_request',
    input: { viewId: id, title: 'Approved changes' },
    method: 'POST',
    route: '/requests',
    body: {
      viewUri: `${auth.instanceUrl}/epm/rest/v1/views/${id}`,
      origin: 'INTERACTIVE',
      title: 'Approved changes',
    },
    provider: { id, status: 'DRAFT' },
  },
  {
    action: 'get_request',
    input: { requestId: id },
    method: 'GET',
    route: `/requests/${id}`,
    provider: { id, status: 'DRAFT', validTransitionActions: ['SUBMIT'] },
  },
  {
    action: 'query_requests',
    input: { requestType: 'Subscription', status: 'In Flight', expandWorkflow: true },
    method: 'GET',
    route: '/requests/byName/query',
    query: { lastDays: '30', requestType: 'Subscription', status: 'In Flight', expand: 'workflow' },
    provider: { items: [] },
  },
  {
    action: 'get_request_lineage',
    input: { requestId: id },
    method: 'GET',
    route: `/requests/${id}/lineage`,
    provider: { requestLineageNodes: [{ id }], subscriptionInstances: [] },
  },
  {
    action: 'assign_request',
    input: { requestNumber: 123, userName: 'reviewer' },
    method: 'POST',
    route: '/requests/assignRequest',
    body: { requestNumber: 123, userName: 'reviewer' },
    provider: { id, requestNumber: 123 },
  },
  {
    action: 'delete_request',
    input: { requestId: id },
    method: 'DELETE',
    route: `/requests/${id}`,
    provider: null,
    status: 204,
  },
  {
    action: 'generate_request_attachment',
    input: {
      requestId: id,
      fileName: 'changes.xlsx',
      items: [{ viewpoint: 'Accounts', data: [{ header: 'Name', value: 'Account1' }] }],
      overwrite: false,
      waitForCompletion: false,
    },
    method: 'POST',
    route: `/requests/${id}/attachments/generate`,
    body: {
      fileName: 'changes.xlsx',
      items: [{ viewpoint: 'Accounts', data: [{ header: 'Name', value: 'Account1' }] }],
      overwrite: false,
    },
    provider: job,
  },
  {
    action: 'import_request_attachment',
    input: { requestId: id, attachmentId: id, sheetNames: ['Accounts'], waitForCompletion: false },
    method: 'POST',
    route: `/requests/${id}/import`,
    body: {
      attachmentUri: `${auth.instanceUrl}/epm/rest/v1/requests/${id}/attachments/${id}`,
      sheetNames: ['Accounts'],
    },
    provider: job,
  },
  {
    action: 'transition_request',
    input: {
      requestId: id,
      action: 'SUBMIT',
      transitionWithWarning: false,
      waitForCompletion: false,
    },
    method: 'POST',
    route: `/requests/${id}/transitions`,
    body: { action: 'SUBMIT', transitionWithWarning: false },
    provider: job,
  },
  {
    action: 'get_job_status',
    input: { jobRunId: id },
    method: 'GET',
    route: `/jobRuns/${id}`,
    provider: { id, status: 'PENDING' },
  },
  {
    action: 'get_job_result',
    input: { jobRunId: id },
    method: 'GET',
    route: `/jobRuns/${id}/result`,
    provider: { id, status: 'COMPLETED', result: { arbitrary: true } },
  },
  {
    action: 'validate_viewpoint',
    input: {
      viewName: 'Enterprise',
      viewpointName: 'Accounts',
      fileName: 'validation.xlsx',
      waitForCompletion: false,
    },
    method: 'POST',
    route: '/viewpoints/validate/writeToFile',
    body: { viewName: 'Enterprise', viewpointName: 'Accounts', fileName: 'validation.xlsx' },
    provider: job,
  },
  {
    action: 'get_mapping_keys',
    input: { dimensionId: id, bindingId: id },
    method: 'GET',
    route: `/dimensions/${id}/bindings/${id}/mappingKeys`,
    provider: { mapKeys: [{ location: 'Planning', defaultLocation: true }] },
  },
  {
    action: 'export_mappings',
    input: { ...names, mappingLocation: 'Planning' },
    method: 'POST',
    route: '/dimensions/byName/exportMappings',
    body: {
      applicationName: 'Planning',
      dimensionName: 'Account',
      fileName: 'account.csv',
      mappingLocation: 'Planning',
    },
    provider: job,
  },
  {
    action: 'import_dimension',
    input: { ...names, importOption: 'Merge' },
    method: 'POST',
    route: '/dimensions/byName/import',
    body: {
      applicationName: 'Planning',
      dimensionName: 'Account',
      fileName: 'account.csv',
      importOption: 'Merge',
    },
    provider: job,
  },
  {
    action: 'load_viewpoint',
    input: {
      viewName: 'Enterprise',
      viewpointName: 'Accounts',
      fileName: 'account.csv',
      purpose: 'Approved changes',
      loadOption: 'Merge',
      waitForCompletion: false,
    },
    method: 'POST',
    route: '/viewpoints/byName/load/file',
    body: {
      viewName: 'Enterprise',
      viewpointName: 'Accounts',
      fileName: 'account.csv',
      purpose: 'Approved changes',
      loadOption: 'Merge',
    },
    provider: job,
  },
  {
    action: 'export_dimension',
    input: names,
    method: 'POST',
    route: '/dimensions/byName/export',
    body: { applicationName: 'Planning', dimensionName: 'Account', fileName: 'account.csv' },
    provider: job,
  },
  {
    action: 'incremental_export_dimension',
    input: {
      ...names,
      bindingNames: ['Account'],
      nodeChangeTypes: ['NEW', 'UPDATED'],
      sinceLastExportOfType: 'FULL',
    },
    method: 'POST',
    route: '/dimensions/byName/incrementalExport',
    body: {
      applicationName: 'Planning',
      dimensionName: 'Account',
      fileName: 'account.csv',
      bindingNames: ['Account'],
      nodeChangeTypes: ['NEW', 'UPDATED'],
      sinceLastExportOfType: 'FULL',
    },
    provider: job,
  },
  {
    action: 'extract_dimension_viewpoint',
    input: {
      ...names,
      extractName: 'Approved extract',
      fromTime: '2026-01-01T00:00 America/New_York',
    },
    method: 'POST',
    route: '/dimensions/byName/extract',
    body: {
      applicationName: 'Planning',
      dimensionName: 'Account',
      fileName: 'account.csv',
      extractName: 'Approved extract',
      fromTime: '2026-01-01T00:00 America/New_York',
    },
    provider: job,
  },
]

describe('EDM internal tool wire contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.dns.mockResolvedValue({ isValid: true, resolvedIP: '203.0.113.10' })
  })
  it.each(cases)('$action sends the documented method, path, and payload', async (test) => {
    mocks.fetch.mockResolvedValue(
      test.status === 204 ? new Response(null, { status: 204 }) : Response.json(test.provider)
    )
    const response = await call(test.action, test.input)
    const result = await response.json()
    expect(result, JSON.stringify(result)).toMatchObject({ success: true })
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    const [url, address, options] = mocks.fetch.mock.calls[0]
    const parsed = new URL(url)
    expect(decodeURIComponent(parsed.pathname)).toBe(`/gateway/epm/rest/v1${test.route}`)
    expect(Object.fromEntries(parsed.searchParams)).toEqual(test.query ?? {})
    expect(address).toBe('203.0.113.10')
    expect(options).toMatchObject({
      method: test.method,
      maxRedirects: 0,
      headers: { Authorization: 'Basic dTpw' },
    })
    if (test.body) expect(JSON.parse(options.body)).toEqual(test.body)
  })
  it.each([
    ['create_request', { viewId: '../admin' }],
    ['import_dimension', names],
    [
      'load_viewpoint',
      { viewName: 'Enterprise', viewpointName: 'Accounts', fileName: 'a.csv', purpose: 'Changes' },
    ],
    ['transition_request', { requestId: id, action: 'DELETE_EVERYTHING' }],
    ['list_nodes', { ...view, limit: 101 }],
    ['browse_hierarchy', { ...view, maxNodes: 501 }],
    ['query_requests', { lastDays: 91 }],
    ['search_nodes', view],
  ] as const)('rejects invalid %s before DNS or provider work', async (action, input) => {
    const response = await call(action, input)
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ success: false, retryable: false })
    expect(mocks.dns).not.toHaveBeenCalled()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
  it('rejects an operation discriminator that does not match the registered tool', async () => {
    const response = await call('get_request', {
      operation: 'oracle_epm_edm_delete_request',
      requestId: id,
    })
    expect(response.status).toBe(400)
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
  it('does not retry an ambiguous write failure or expose its provider body', async () => {
    mocks.fetch.mockResolvedValue(new Response('provider-secret-canary', { status: 503 }))
    const response = await call('create_request', { viewId: id })
    const result = await response.json()
    expect(result).toMatchObject({ success: false, retryable: false })
    expect(JSON.stringify(result)).not.toContain('provider-secret-canary')
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })
  it('does not turn a malformed successful provider response into success', async () => {
    mocks.fetch.mockResolvedValue(Response.json({ futureSecret: 'provider-secret-canary' }))
    const response = await call('get_request', { requestId: id })
    expect(response.status).toBe(502)
    expect(await response.text()).not.toContain('provider-secret-canary')
  })
  it('honors cancellation before starting the request', async () => {
    await expect(call('get_request', { requestId: id }, AbortSignal.abort())).rejects.toThrow()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
})
