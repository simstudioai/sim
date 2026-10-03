/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), dns: vi.fn(), source: vi.fn(), store: vi.fn() }))
vi.mock('@/lib/core/security/input-validation.server', () => ({
  DEFAULT_MAX_RESPONSE_BYTES: 100 * 1024 * 1024,
  secureFetchWithPinnedIP: mocks.fetch,
  validateUrlWithDNS: mocks.dns,
}))
vi.mock('@/lib/internal/oracle-epm/files.server', () => ({
  openOracleEpmSourceFile: mocks.source,
  storeOracleEpmDownload: mocks.store,
}))

import { readStreamToBufferWithLimit } from '@/lib/core/utils/stream-limits'
import { executeOracleEpmEdmTool } from '@/lib/internal/oracle-epm-enterprise-data-management/execute-tool'

const requestId = '11111111-1111-4111-8111-111111111111'
const attachmentId = '22222222-2222-4222-8222-222222222222'
const jobId = '33333333-3333-4333-8333-333333333333'
const root = 'https://edm.example.com/epm/rest/v1'
const file = {
  id: 'file',
  name: 'changes.csv',
  size: 3,
  type: 'text/csv',
  key: 'workspace/changes.csv',
  context: 'workspace',
  url: '',
}
const job = { id: jobId, status: 'COMPLETED' }
const accepted = { links: [{ rel: 'results', href: `${root}/jobRuns/${jobId}` }] }
const resultEnvelope = { ...job, result: null }
async function callResponse(action: string, input: Record<string, unknown>) {
  const response = await executeOracleEpmEdmTool({
    toolId: `oracle_epm_edm_${action}`,
    input: {
      oauthCredential: 'credential',
      accessToken: 'dTpw',
      instanceUrl: 'https://edm.example.com',
      operation: `oracle_epm_edm_${action}`,
      ...input,
    },
    headers: new Headers(),
    requestId: 'test-request',
    context: {
      workflowId: requestId,
      workspaceId: requestId,
      executionId: requestId,
      userId: 'user',
    },
  })
  return response
}
async function call(action: string, input: Record<string, unknown>) {
  return (await callResponse(action, input)).json()
}
describe('EDM governed request and transfer workflows', () => {
  it.each(['status', 'result', 'download', 'storage'] as const)(
    'preserves the accepted job handle when %s follow-up fails',
    async (phase) => {
      mocks.fetch.mockResolvedValueOnce(Response.json(accepted))
      if (phase !== 'status') mocks.fetch.mockResolvedValueOnce(Response.json(job))
      if (phase === 'download' || phase === 'storage')
        mocks.fetch.mockResolvedValueOnce(Response.json(resultEnvelope))
      if (phase === 'storage') {
        mocks.fetch.mockResolvedValueOnce(new Response('abc'))
        mocks.store.mockRejectedValueOnce(new Error('private-storage-secret'))
      } else
        mocks.fetch.mockResolvedValueOnce(new Response('private-provider-secret', { status: 503 }))
      const response = await callResponse('export_dimension', {
        applicationName: 'Planning',
        dimensionName: 'Account',
        fileName: 'result.csv',
      })
      // Non-2xx internal responses take a different shared executor path and lose normal outputs.
      expect(response.status).toBe(200)
      const result = await response.json()
      expect(result).toMatchObject({
        success: false,
        retryable: false,
        output: { jobId, fileName: 'result.csv' },
      })
      expect(JSON.stringify(result)).not.toContain('private-provider-secret')
      expect(JSON.stringify(result)).not.toContain('private-storage-secret')
      expect(mocks.fetch.mock.calls.filter((call) => call[2].method === 'POST')).toHaveLength(1)
    }
  )
  it('preserves the accepted job handle when the opaque result exceeds the output budget', async () => {
    mocks.fetch
      .mockResolvedValueOnce(Response.json(accepted))
      .mockResolvedValueOnce(Response.json(job))
      .mockImplementationOnce(
        async (_url: string, _ip: string, options: { maxResponseBytes: number }) => {
          const response = Response.json({ ...job, result: 'x'.repeat(8 * 1024 * 1024) })
          // Model secureFetch's bounded JSON reader using the actual requested endpoint budget.
          response.json = async () =>
            JSON.parse(
              (
                await readStreamToBufferWithLimit(response.body, {
                  maxBytes: options.maxResponseBytes,
                  label: 'EDM result response',
                })
              ).toString('utf8')
            )
          return response
        }
      )
    const response = await callResponse('export_dimension', {
      applicationName: 'Planning',
      dimensionName: 'Account',
      fileName: 'result.csv',
    })
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result).toMatchObject({
      success: false,
      retryable: false,
      output: { jobId, fileName: 'result.csv', completed: true },
    })
    expect(result.output).not.toHaveProperty('result')
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(10 * 1024 * 1024)
    expect(mocks.fetch.mock.calls.filter((call) => call[2].method === 'POST')).toHaveLength(1)
  })
  it('keeps a documented completed-job business failure opaque and available to callers', async () => {
    // Oracle's byName export example has COMPLETED with result.success false.
    const result = { success: false }
    mocks.fetch
      .mockResolvedValueOnce(Response.json(accepted))
      .mockResolvedValueOnce(Response.json(job))
      .mockResolvedValueOnce(Response.json({ ...job, result }))
    const response = await call('export_dimension', {
      applicationName: 'Planning',
      dimensionName: 'Account',
      fileName: 'result.csv',
      connection: 'Planning',
    })
    expect(response.output.completed).toBe(true)
    expect(response.output.result.result).toEqual(result)
    expect(response.output).not.toHaveProperty('businessSuccess')
  })
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.dns.mockResolvedValue({ isValid: true, resolvedIP: '203.0.113.10' })
    mocks.source.mockImplementation(async () => ({
      fileName: 'changes.csv',
      contentType: 'text/csv',
      maxBytes: 95 * 1024 * 1024,
      chunks: (async function* () {
        yield Buffer.from('abc')
      })(),
    }))
    mocks.store.mockResolvedValue({ ...file, context: 'execution', key: 'execution/result.csv' })
  })
  it('creates a request, uploads an attachment, imports its sheets, and transitions after completion', async () => {
    mocks.fetch
      .mockResolvedValueOnce(
        Response.json({ id: requestId, status: 'DRAFT', validTransitionActions: ['SUBMIT'] })
      )
      .mockResolvedValueOnce(
        Response.json({
          links: [
            {
              rel: 'attachment',
              href: `${root}/requests/${requestId}/attachments/${attachmentId}`,
            },
          ],
        })
      )
      .mockResolvedValueOnce(Response.json(accepted))
      .mockResolvedValueOnce(Response.json(job))
      .mockResolvedValueOnce(Response.json(resultEnvelope))
      .mockResolvedValueOnce(Response.json(accepted))
      .mockResolvedValueOnce(Response.json(job))
      .mockResolvedValueOnce(Response.json(resultEnvelope))
    const created = await call('create_request', { viewId: requestId, title: 'Approved updates' })
    const uploaded = await call('upload_request_attachment', {
      requestId: created.output.request.id,
      file,
    })
    expect(uploaded).toMatchObject({
      success: true,
      output: { attachmentId, requestId, fileName: 'changes.csv' },
    })
    const imported = await call('import_request_attachment', {
      requestId,
      attachmentId: uploaded.output.attachmentId,
      sheetNames: ['Accounts'],
    })
    expect(imported).toMatchObject({ success: true, output: { completed: true, jobId } })
    const transitioned = await call('transition_request', {
      requestId,
      action: created.output.request.validTransitionActions[0],
      transitionWithWarning: false,
    })
    expect(transitioned).toMatchObject({ success: true, output: { completed: true } })
    const writes = mocks.fetch.mock.calls.filter((call) => call[2].method === 'POST')
    expect(writes.map((call) => new URL(call[0]).pathname)).toEqual([
      '/epm/rest/v1/requests',
      `/epm/rest/v1/requests/${requestId}/attachments/importFile`,
      `/epm/rest/v1/requests/${requestId}/import`,
      `/epm/rest/v1/requests/${requestId}/transitions`,
    ])
    expect(JSON.parse(writes[2][2].body)).toEqual({
      attachmentUri: uploaded.output.attachmentUri,
      sheetNames: ['Accounts'],
    })
    expect(JSON.parse(writes[3][2].body)).toEqual({
      action: 'SUBMIT',
      transitionWithWarning: false,
    })
  })
  it('stages a Sim file before an explicit Merge import and returns the completion envelope', async () => {
    mocks.fetch
      .mockResolvedValueOnce(
        Response.json({ links: [{ rel: 'file', href: `${root}/files/staging/changes.csv` }] })
      )
      .mockResolvedValueOnce(Response.json(accepted))
      .mockResolvedValueOnce(Response.json(job))
      .mockResolvedValueOnce(Response.json({ ...job, result: { requestSpecific: 'opaque' } }))
    const result = await call('import_dimension', {
      applicationName: 'Planning',
      dimensionName: 'Account',
      fileName: 'changes.csv',
      importOption: 'Merge',
      file,
    })
    expect(result).toMatchObject({
      success: true,
      output: { completed: true, result: { result: { requestSpecific: 'opaque' } } },
    })
    expect(mocks.fetch.mock.calls.map((call) => new URL(call[0]).pathname)).toEqual([
      '/epm/rest/v1/files/staging',
      '/epm/rest/v1/dimensions/byName/import',
      `/epm/rest/v1/jobRuns/${jobId}`,
      `/epm/rest/v1/jobRuns/${jobId}/result`,
    ])
  })
  it('stops before starting an import when Oracle advertises a different staged file', async () => {
    mocks.fetch.mockResolvedValue(
      Response.json({ links: [{ rel: 'file', href: `${root}/files/staging/wrong.csv` }] })
    )
    const result = await call('import_dimension', {
      applicationName: 'Planning',
      dimensionName: 'Account',
      fileName: 'changes.csv',
      importOption: 'Merge',
      file,
    })
    expect(result).toMatchObject({ success: false, retryable: false })
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })
  it('reports a failed attachment import without retrying the write or reading a success result', async () => {
    mocks.fetch
      .mockResolvedValueOnce(Response.json(accepted))
      .mockResolvedValueOnce(
        Response.json({ id: jobId, status: 'ERROR', error: 'Invalid request sheet' })
      )
    const result = await call('import_request_attachment', {
      requestId,
      attachmentId,
      sheetNames: ['Accounts'],
    })
    expect(result).toMatchObject({
      success: false,
      retryable: false,
      output: { jobId, completed: false, job: { status: 'ERROR' } },
    })
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
  })
  it.each([
    [
      'export_dimension',
      { applicationName: 'Planning', dimensionName: 'Account', fileName: 'result.csv' },
    ],
    [
      'extract_dimension_viewpoint',
      {
        applicationName: 'Planning',
        dimensionName: 'Account',
        fileName: 'result.csv',
        extractName: 'Current',
      },
    ],
    [
      'export_mappings',
      {
        applicationName: 'Planning',
        dimensionName: 'Account',
        fileName: 'result.csv',
        mappingLocation: 'Planning',
      },
    ],
    [
      'validate_viewpoint',
      { viewName: 'Enterprise', viewpointName: 'Accounts', fileName: 'result.csv' },
    ],
  ] as const)('%s completes and returns a stored Sim file', async (action, input) => {
    mocks.fetch
      .mockResolvedValueOnce(Response.json(accepted))
      .mockResolvedValueOnce(Response.json(job))
      .mockResolvedValueOnce(Response.json(resultEnvelope))
      .mockResolvedValueOnce(new Response('abc', { headers: { 'Content-Type': 'text/csv' } }))
    const result = await call(action, input)
    expect(result).toMatchObject({
      success: true,
      output: { completed: true, file: { context: 'execution' } },
    })
    expect(new URL(mocks.fetch.mock.calls[3][0]).pathname).toBe(
      '/epm/rest/v1/files/staging/result.csv'
    )
  })
  it('exports to an Oracle connection without attempting a Sim file download', async () => {
    mocks.fetch
      .mockResolvedValueOnce(Response.json(accepted))
      .mockResolvedValueOnce(Response.json(job))
      .mockResolvedValueOnce(Response.json(resultEnvelope))
    const result = await call('export_dimension', {
      applicationName: 'Planning',
      dimensionName: 'Account',
      fileName: 'result.csv',
      connection: 'Planning Connection',
    })
    expect(result).toMatchObject({ success: true, output: { completed: true } })
    expect(result.output).not.toHaveProperty('file')
    expect(mocks.store).not.toHaveBeenCalled()
    expect(mocks.fetch).toHaveBeenCalledTimes(3)
  })
  it('preserves subscription lineage for operational investigation without administration calls', async () => {
    const instance = {
      id: attachmentId,
      subscriptionStatus: 'INCOMPLETE',
      sourceRequest: requestId,
      targetRequest: jobId,
      message: 'Review required',
    }
    mocks.fetch.mockResolvedValue(
      Response.json({
        requestLineageNodes: [
          {
            id: jobId,
            origin: 'SUBSCRIPTION',
            sourceRequest: { id: requestId },
            incompleteSubscriptions: [instance],
          },
        ],
        subscriptionInstances: [instance],
      })
    )
    const result = await call('get_request_lineage', { requestId })
    expect(result).toMatchObject({
      success: true,
      output: {
        lineage: {
          requestLineageNodes: [
            {
              origin: 'SUBSCRIPTION',
              sourceRequest: { id: requestId },
              incompleteSubscriptions: [instance],
            },
          ],
          subscriptionInstances: [instance],
        },
      },
    })
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })
})
