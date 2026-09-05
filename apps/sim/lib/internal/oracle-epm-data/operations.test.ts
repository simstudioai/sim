/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  createClient: vi.fn(),
  source: vi.fn(),
  store: vi.fn(),
}))
vi.mock('@/lib/internal/oracle-epm/client.server', () => ({
  createOracleEpmClient: mocks.createClient,
}))
vi.mock('@/lib/internal/oracle-epm/files.server', () => ({
  openOracleEpmSourceFile: mocks.source,
  storeOracleEpmDownload: mocks.store,
}))

import {
  oracleEpmDataEndpoints as endpoints,
  ORACLE_EPM_DATA_FILE_MAX_BYTES,
} from '@/lib/internal/oracle-epm-data/contracts'
import * as operations from '@/lib/internal/oracle-epm-data/operations'

const auth = {
  oauthCredential: 'credential',
  accessToken: 'resolved-token',
  instanceUrl: 'https://epm.example.com/gateway',
}
const context = {
  userId: 'user-1',
  workflowId: '11111111-1111-4111-8111-111111111111',
  workspaceId: '22222222-2222-4222-8222-222222222222',
  executionId: '33333333-3333-4333-8333-333333333333',
}
const file = {
  id: 'file-id',
  key: 'workspace/test.csv',
  url: '/api/files/test.csv',
  name: 'test.csv',
  size: 3,
  type: 'text/csv',
}
const status = { status: 0, details: null }
const job = { ...status, jobId: 42 }
const connection = {
  status: 0,
  sourceSystemId: 3,
  sourceSystemName: 'Source',
  sourceSystemType: 'Oracle ERP Cloud',
  sourceSystemOptions: [],
}

describe('Data Integration provider operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createClient.mockReturnValue({ request: mocks.request })
    mocks.request.mockResolvedValue({ status: 200, data: job })
    mocks.source.mockImplementation(async () => ({
      chunks: (async function* () {
        yield Buffer.from('abc')
      })(),
    }))
    mocks.store.mockResolvedValue(file)
  })

  it('lists and reads connections using documented fields, without following refUrl', async () => {
    mocks.request.mockResolvedValueOnce({
      status: 200,
      data: {
        ...status,
        response: [{ connectionName: 'Source', refUrl: 'https://unused.example.com' }],
      },
    })
    expect(await operations.executeOracleEpmDataListConnectionsOperation(auth)).toEqual({
      success: true,
      output: {
        httpStatus: 200,
        ...status,
        connections: [{ connectionName: 'Source', refUrl: 'https://unused.example.com' }],
      },
    })
    mocks.request.mockResolvedValueOnce({ status: 200, data: { ...status, response: connection } })
    expect(
      await operations.executeOracleEpmDataGetConnectionOperation({
        ...auth,
        connectionName: 'Source',
      })
    ).toMatchObject({ success: true, output: { connection: { sourceSystemId: '3' } } })
    expect(mocks.request.mock.calls[0][0]).toBe(endpoints.listConnections)
    expect(mocks.request.mock.calls[1]).toEqual([
      endpoints.getConnection,
      { pathParams: { connectionName: 'Source' }, signal: undefined },
    ])
    expect(mocks.createClient).toHaveBeenCalledWith({
      accessToken: auth.accessToken,
      instanceUrl: auth.instanceUrl,
    })
  })

  it('does not turn a nested connection failure into success', async () => {
    mocks.request.mockResolvedValue({
      status: 200,
      data: { ...status, response: { ...connection, status: 1 } },
    })
    expect(
      await operations.executeOracleEpmDataGetConnectionOperation({
        ...auth,
        connectionName: 'Source',
      })
    ).toMatchObject({ success: false })
  })

  it('updates exactly the documented connection option array', async () => {
    mocks.request.mockResolvedValue({
      status: 200,
      data: { ...status, response: 'Connection updated successfully' },
    })
    const input = {
      sourceSystemId: '3',
      sourceSystemName: 'Source',
      sourceSystemType: 'Oracle ERP Cloud',
      sourceSystemOptions: [{ optionName: 'Password', optionValue: 'synthetic-encrypted-value' }],
    }
    expect(
      await operations.executeOracleEpmDataUpdateConnectionOperation({ ...auth, ...input })
    ).toMatchObject({ success: true })
    expect(mocks.request).toHaveBeenCalledWith(endpoints.updateConnection, {
      json: input,
      signal: undefined,
    })
  })

  it('gets a documented pipeline definition with nullable variables', async () => {
    const pipeline = {
      name: 'Load26',
      displayName: 'Load',
      id: 4,
      parallelJobs: 1,
      variables: [
        {
          varName: 'MONTH',
          varDisplayName: 'Month',
          varDefaultValue: null,
          varType: 'Text',
          varValObject: null,
          varSequence: 1,
          varDefaultParam: 'N',
        },
      ],
      stages: [],
    }
    mocks.request.mockResolvedValue({ status: 200, data: { ...status, response: pipeline } })
    expect(
      await operations.executeOracleEpmDataGetPipelineDetailsOperation({
        ...auth,
        pipelineCode: 'Load26',
      })
    ).toMatchObject({ success: true, output: { pipeline } })
    expect(mocks.request).toHaveBeenCalledWith(endpoints.getPipeline, {
      query: { pipelineName: 'Load26' },
      signal: undefined,
    })
  })

  it('preserves opaque integration JSON without inferring acceptance or execution IDs', async () => {
    // Deliberately synthetic JSON: this is NOT an Oracle response fixture.
    const synthetic = {
      arbitrary: ['value', null],
      status: 'not a documented contract',
      nested: { example: 12 },
    }
    mocks.request.mockResolvedValue({ status: 202, data: synthetic })
    const input = {
      jobName: 'Load',
      periodName: '{Jan-26}',
      importMode: 'Direct',
      exportMode: 'MERGE',
      executionMode: 'ASYNC' as const,
      sourceFilters: { 'Fiscal Year': 'FY26' },
      targetOptions: { 'Refresh Database': 'Yes' },
    }
    expect(
      await operations.executeOracleEpmDataRunIntegrationOperation({ ...auth, ...input })
    ).toEqual({ success: true, output: { httpStatus: 202, data: synthetic } })
    expect(mocks.request).toHaveBeenCalledOnce()
    expect(mocks.request).toHaveBeenCalledWith(endpoints.submitJob, {
      json: { ...input, jobType: 'INTEGRATION', fileName: undefined },
      signal: undefined,
    })
  })

  it('submits pipeline codes and tenant variable names with opaque response pass-through', async () => {
    const synthetic = [null, { example: 'synthetic' }]
    mocks.request.mockResolvedValue({ status: 200, data: synthetic })
    expect(
      await operations.executeOracleEpmDataRunPipelineOperation({
        ...auth,
        pipelineCode: 'Load26',
        variables: { MONTH: 'Jan-26' },
      })
    ).toEqual({ success: true, output: { httpStatus: 200, data: synthetic } })
    expect(mocks.request).toHaveBeenCalledOnce()
    expect(mocks.request).toHaveBeenCalledWith(endpoints.submitJob, {
      json: { jobType: 'PIPELINE', jobName: 'Load26', variables: { MONTH: 'Jan-26' } },
      signal: undefined,
    })
  })

  it('maps data rules, batches, reports and mapping jobs without implicit waiting', async () => {
    await operations.executeOracleEpmDataRunDataRuleOperation({
      ...auth,
      jobName: 'Rule',
      startPeriod: 'Jan-26',
      endPeriod: 'Mar-26',
      importMode: 'REPLACE',
      exportMode: 'STORE_DATA',
      fileName: 'inbox/data.csv',
    })
    await operations.executeOracleEpmDataRunBatchOperation({ ...auth, jobName: 'Batch' })
    await operations.executeOracleEpmDataExecuteReportOperation({
      ...auth,
      jobName: 'Report',
      reportFormatType: 'PDF',
      parameters: { Location: 'Source' },
    })
    await operations.executeOracleEpmDataImportMappingsOperation({
      ...auth,
      dimension: 'ALL',
      fileName: 'inbox/map.csv',
      importMode: 'REPLACE',
      validationMode: false,
      locationName: 'Source',
    })
    await operations.executeOracleEpmDataExportMappingsOperation({
      ...auth,
      dimension: 'Account',
      fileName: 'outbox/map.csv',
      locationName: 'Source',
    })
    expect(
      mocks.request.mock.calls.map(([endpoint, input]) => {
        expect(endpoint).toBe(endpoints.submitJob)
        return Object.fromEntries(
          Object.entries(input.json).filter(([, value]) => value !== undefined)
        )
      })
    ).toEqual([
      {
        jobType: 'DATARULE',
        jobName: 'Rule',
        startPeriod: 'Jan-26',
        endPeriod: 'Mar-26',
        importMode: 'REPLACE',
        exportMode: 'STORE_DATA',
        fileName: 'inbox/data.csv',
      },
      { jobType: 'BATCH', jobName: 'Batch' },
      {
        jobType: 'REPORT',
        jobName: 'Report',
        reportFormatType: 'PDF',
        parameters: { Location: 'Source' },
      },
      {
        jobType: 'MAPPINGIMPORT',
        jobName: 'ALL',
        fileName: 'inbox/map.csv',
        importMode: 'REPLACE',
        validationMode: false,
        locationName: 'Source',
      },
      {
        jobType: 'MAPPINGEXPORT',
        jobName: 'Account',
        fileName: 'outbox/map.csv',
        locationName: 'Source',
      },
    ])
  })

  it('reads a known job and preserves status independently of HTTP status', async () => {
    mocks.request.mockResolvedValue({
      status: 200,
      data: { status: 4, jobId: '42', details: null },
    })
    expect(
      await operations.executeOracleEpmDataGetJobStatusOperation({ ...auth, jobId: '42' })
    ).toMatchObject({ success: false, output: { httpStatus: 200, status: 4, jobId: '42' } })
    expect(mocks.request).toHaveBeenCalledWith(endpoints.getJob, {
      pathParams: { jobId: '42' },
      signal: undefined,
    })
  })

  it('never resubmits an accepted documented job after polling failure', async () => {
    mocks.request
      .mockResolvedValueOnce({ status: 200, data: { status: -1, jobId: 42 } })
      .mockRejectedValueOnce(new Error('Synthetic poll failure'))
    expect(
      await operations.executeOracleEpmDataRunBatchOperation({
        ...auth,
        jobName: 'Batch',
        waitForCompletion: true,
      })
    ).toMatchObject({ success: false, retryable: false, output: { jobId: '42' } })
    expect(mocks.request.mock.calls.map(([endpoint]) => endpoint)).toEqual([
      endpoints.submitJob,
      endpoints.getJob,
    ])
  })

  it('maps snapshot modes and never polls an import placeholder ID', async () => {
    mocks.request.mockResolvedValueOnce({
      status: 200,
      data: { status: -1, jobId: 0, action: 'IMPORT' },
    })
    expect(
      await operations.executeOracleEpmDataImportDataIntegrationOperation({
        ...auth,
        fileName: 'inbox/setup.zip',
      })
    ).toMatchObject({ success: true, output: { jobId: '0', status: -1, action: 'IMPORT' } })
    await operations.executeOracleEpmDataExportDataIntegrationOperation({
      ...auth,
      fileName: 'setup.zip',
      snapshotType: 'SETUP',
      overwriteFile: false,
    })
    expect(mocks.request.mock.calls).toEqual([
      [
        endpoints.snapshot,
        { json: { action: 'IMPORT', fileName: 'inbox/setup.zip' }, signal: undefined },
      ],
      [
        endpoints.snapshot,
        {
          json: {
            action: 'EXPORT',
            fileName: 'setup.zip',
            snapshotType: 'SETUP',
            overwriteFile: false,
          },
          signal: undefined,
        },
      ],
    ])
  })

  it('maps POV query scope and lower-case lock fields without mixing location and application locks', async () => {
    const pov = {
      period: 'Jan-26',
      category: 'Actual',
      application: 'Plan',
      location: 'Source',
      status: 'Locked',
    }
    mocks.request
      .mockResolvedValueOnce({ status: 200, data: { ...status, response: [pov] } })
      .mockResolvedValue({ status: 200, data: { ...status, response: 'POV unlocked' } })
    expect(
      await operations.executeOracleEpmDataGetPovStatusOperation({
        ...auth,
        period: 'Jan-26',
        category: 'Actual',
        application: 'Plan',
        locationName: 'Source',
      })
    ).toMatchObject({ success: true, output: { povs: [pov] } })
    await operations.executeOracleEpmDataSetPovLockOperation({
      ...auth,
      period: 'Jan-26',
      category: 'Actual',
      lockType: 'location',
      lockOperation: 'unlock',
      locationName: 'Source',
      application: 'Plan',
    })
    await operations.executeOracleEpmDataSetPovLockOperation({
      ...auth,
      period: 'Jan-26',
      category: 'Actual',
      lockType: 'application',
      lockOperation: 'unlock',
      application: 'Plan',
      unlockByLocation: true,
    })
    expect(mocks.request.mock.calls).toEqual([
      [
        endpoints.getPov,
        {
          query: { period: 'Jan-26', category: 'Actual', application: 'Plan', location: 'Source' },
          signal: undefined,
        },
      ],
      [
        endpoints.setPov,
        {
          json: {
            period: 'Jan-26',
            category: 'Actual',
            locktype: 'location',
            operation: 'unlock',
            location: 'Source',
          },
          signal: undefined,
        },
      ],
      [
        endpoints.setPov,
        {
          json: {
            period: 'Jan-26',
            category: 'Actual',
            locktype: 'application',
            operation: 'unlock',
            application: 'Plan',
            unlockbylocation: true,
          },
          signal: undefined,
        },
      ],
    ])
  })

  it('lists nullable repository metadata and deletes only the supplied raw filename', async () => {
    const files = [{ name: 'outbox/map.csv', type: 'EXTERNAL', size: '3', lastmodifiedtime: null }]
    mocks.request
      .mockResolvedValueOnce({ status: 200, data: { ...status, items: files } })
      .mockResolvedValueOnce({ status: 200, data: status })
    expect(await operations.executeOracleEpmDataListFilesOperation(auth)).toMatchObject({
      success: true,
      output: { files },
    })
    expect(
      await operations.executeOracleEpmDataDeleteFileOperation({
        ...auth,
        fileName: 'outbox/map.csv',
      })
    ).toMatchObject({ success: true, output: { fileName: 'outbox/map.csv' } })
    expect(mocks.request.mock.calls[1]).toEqual([
      endpoints.deleteFile,
      { json: { fileName: 'outbox/map.csv' }, signal: undefined },
    ])
  })

  it('fails safely on malformed contracts, provider errors and transport failure', async () => {
    mocks.request
      .mockResolvedValueOnce({
        status: 200,
        data: { status: 0, response: [{ undocumented: 'field' }] },
      })
      .mockResolvedValueOnce({
        status: 200,
        data: { status: 1, details: 'Synthetic provider failure' },
      })
      .mockRejectedValueOnce(new Error('Synthetic transport failure'))
    expect(await operations.executeOracleEpmDataListConnectionsOperation(auth)).toMatchObject({
      success: false,
      error: 'Oracle EPM returned a malformed documented response',
    })
    expect(await operations.executeOracleEpmDataListConnectionsOperation(auth)).toMatchObject({
      success: false,
      output: { status: 1, httpStatus: 200 },
    })
    expect(
      await operations.executeOracleEpmDataRunPipelineOperation({ ...auth, pipelineCode: 'Load26' })
    ).toMatchObject({ success: false, retryable: false })
    expect(mocks.request).toHaveBeenCalledTimes(3)
  })

  it('authorizes one upload with trusted identity and the 100 MiB declared/actual reader cap', async () => {
    mocks.request.mockResolvedValue({ status: 200, data: status })
    const signal = new AbortController().signal
    expect(
      await operations.executeOracleEpmDataUploadFileOperation(
        { ...auth, file, fileName: 'data.csv', extDirPath: 'inbox' },
        signal,
        context
      )
    ).toMatchObject({ success: true, output: { fileName: 'inbox/data.csv' } })
    expect(mocks.source).toHaveBeenCalledWith({
      file,
      userId: context.userId,
      maxBytes: 100 * 1024 * 1024,
      signal,
    })
    expect(mocks.request).toHaveBeenCalledWith(endpoints.uploadFile, {
      pathParams: { fileName: 'data.csv' },
      query: { extDirPath: 'inbox' },
      stream: Buffer.from('abc'),
      signal,
    })
  })

  it('does not fetch or upload when trusted identity is missing or file authorization/size validation fails', async () => {
    expect(
      await operations.executeOracleEpmDataUploadFileOperation({
        ...auth,
        file,
        fileName: 'data.csv',
      })
    ).toMatchObject({ success: false })
    expect(mocks.source).not.toHaveBeenCalled()
    mocks.source.mockRejectedValue(new Error('Synthetic source authorization or size failure'))
    expect(
      await operations.executeOracleEpmDataUploadFileOperation(
        { ...auth, file, fileName: 'data.csv' },
        undefined,
        context
      )
    ).toMatchObject({ success: false })
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it('stops upload on actual-byte reader failure or cancellation, closing the source iterator', async () => {
    const closed = vi.fn()
    mocks.source.mockResolvedValue({
      chunks: (async function* () {
        try {
          yield Buffer.from('abc')
          throw new Error('Synthetic actual-byte limit')
        } finally {
          closed()
        }
      })(),
    })
    expect(
      await operations.executeOracleEpmDataUploadFileOperation(
        { ...auth, file, fileName: 'data.csv' },
        undefined,
        context
      )
    ).toMatchObject({ success: false })
    expect(closed).toHaveBeenCalledOnce()
    const controller = new AbortController()
    mocks.source.mockResolvedValue({
      chunks: (async function* () {
        controller.abort()
        yield Buffer.from('abc')
      })(),
    })
    expect(
      await operations.executeOracleEpmDataUploadFileOperation(
        { ...auth, file, fileName: 'data.csv' },
        controller.signal,
        context
      )
    ).toMatchObject({ success: false })
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it('stores a binary download through the capped foundation storage contract', async () => {
    const body = new Response('abc').body
    const signal = new AbortController().signal
    mocks.request.mockResolvedValue({
      status: 200,
      body,
      contentType: 'text/csv',
      contentLength: 3,
    })
    expect(
      await operations.executeOracleEpmDataDownloadFileOperation(
        { ...auth, fileName: 'outbox/data.csv' },
        signal,
        context
      )
    ).toEqual({ success: true, output: { httpStatus: 200, fileName: 'outbox/data.csv', file } })
    expect(mocks.store).toHaveBeenCalledWith({
      body,
      fileName: 'data.csv',
      contentType: 'text/csv',
      contentLength: 3,
      maxBytes: ORACLE_EPM_DATA_FILE_MAX_BYTES,
      signal,
      context: {
        workspaceId: context.workspaceId,
        workflowId: context.workflowId,
        executionId: context.executionId,
      },
    })
  })

  it.each(['application/json; charset=utf-8', 'application/problem+json'])(
    'never stores a %s Oracle error as a downloaded UserFile',
    async (contentType) => {
      mocks.request.mockResolvedValue({
        status: 200,
        body: new Response(JSON.stringify({ status: 8, details: 'Synthetic missing file' })).body,
        contentType,
      })
      expect(
        await operations.executeOracleEpmDataDownloadFileOperation(
          { ...auth, fileName: 'outbox/missing.csv' },
          undefined,
          context
        )
      ).toMatchObject({
        success: false,
        output: { httpStatus: 200, status: 8 },
        error: expect.stringContaining('JSON error'),
      })
      expect(mocks.store).not.toHaveBeenCalled()
    }
  )

  it('requires valid trusted storage context and propagates bounded-storage failures without fallback', async () => {
    expect(
      await operations.executeOracleEpmDataDownloadFileOperation(
        { ...auth, fileName: 'data.csv' },
        undefined,
        { ...context, executionId: undefined }
      )
    ).toMatchObject({ success: false })
    expect(mocks.request).not.toHaveBeenCalled()
    mocks.request.mockResolvedValue({
      status: 200,
      body: new Response('abc').body,
      contentType: 'application/octet-stream',
    })
    mocks.store.mockRejectedValue(new Error('Synthetic actual-byte cap or storage cleanup failure'))
    expect(
      await operations.executeOracleEpmDataDownloadFileOperation(
        { ...auth, fileName: 'data.csv' },
        undefined,
        context
      )
    ).toMatchObject({ success: false, retryable: false })
    expect(mocks.store.mock.calls[0][0]).toMatchObject({
      maxBytes: 100 * 1024 * 1024,
      contentLength: undefined,
    })
    expect(mocks.request).toHaveBeenCalledOnce()
  })
})
