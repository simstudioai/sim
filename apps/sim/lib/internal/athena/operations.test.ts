/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createAthenaClient: vi.fn(),
  destroy: vi.fn(),
  send: vi.fn(),
}))

vi.mock('@/lib/internal/athena/client', () => ({
  createAthenaClient: mocks.createAthenaClient,
}))

import {
  executeAthenaBatchGetPreparedStatement,
  executeAthenaGetQueryResults,
  executeAthenaGetQueryRuntimeStatistics,
  executeAthenaGetWorkGroup,
  executeAthenaListNamedQueries,
  executeAthenaStartQuery,
  executeAthenaUpdateNamedQuery,
} from '@/lib/internal/athena/operations'

const CONNECTION = {
  region: 'us-east-1',
  accessKeyId: 'access-key',
  secretAccessKey: 'secret-key',
}

describe('Athena operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createAthenaClient.mockReturnValue({ send: mocks.send, destroy: mocks.destroy })
  })

  it('preserves first-page header handling and forwards cancellation', async () => {
    const controller = new AbortController()
    mocks.send.mockResolvedValue({
      ResultSet: {
        ResultSetMetadata: {
          ColumnInfo: [
            { Name: 'name', Type: 'varchar' },
            { Name: 'count', Type: 'bigint' },
          ],
        },
        Rows: [
          { Data: [{ VarCharValue: 'name' }, { VarCharValue: 'count' }] },
          { Data: [{ VarCharValue: 'sim' }, { VarCharValue: '3' }] },
        ],
      },
      NextToken: 'next-page',
      UpdateCount: 1,
    })

    await expect(
      executeAthenaGetQueryResults(
        { ...CONNECTION, queryExecutionId: 'query-id', maxResults: 10 },
        controller.signal
      )
    ).resolves.toEqual({
      success: true,
      output: {
        columns: [
          { name: 'name', type: 'varchar' },
          { name: 'count', type: 'bigint' },
        ],
        rows: [{ name: 'sim', count: '3' }],
        nextToken: 'next-page',
        updateCount: 1,
      },
    })
    expect(mocks.send.mock.calls[0]?.[0].input).toEqual({
      QueryExecutionId: 'query-id',
      MaxResults: 11,
    })
    expect(mocks.send.mock.calls[0]?.[1]).toEqual({ abortSignal: controller.signal })
    expect(mocks.destroy).toHaveBeenCalledOnce()
  })

  it('does not strip a row or increase the page size on continuation pages', async () => {
    mocks.send.mockResolvedValue({
      ResultSet: {
        ResultSetMetadata: { ColumnInfo: [{ Name: 'name', Type: 'varchar' }] },
        Rows: [{ Data: [{ VarCharValue: 'continued' }] }],
      },
    })

    await expect(
      executeAthenaGetQueryResults({
        ...CONNECTION,
        queryExecutionId: 'query-id',
        maxResults: 10,
        nextToken: 'current-page',
      })
    ).resolves.toMatchObject({ output: { rows: [{ name: 'continued' }] } })
    expect(mocks.send.mock.calls[0]?.[0].input).toEqual({
      QueryExecutionId: 'query-id',
      MaxResults: 10,
      NextToken: 'current-page',
    })
    expect(mocks.destroy).toHaveBeenCalledOnce()
  })

  it('destroys the client when provider execution fails', async () => {
    mocks.send.mockRejectedValue(new Error('provider failure'))

    await expect(executeAthenaListNamedQueries(CONNECTION)).rejects.toThrow('provider failure')
    expect(mocks.destroy).toHaveBeenCalledOnce()
  })

  it('sends execution parameters and result reuse configuration on start query', async () => {
    mocks.send.mockResolvedValue({ QueryExecutionId: 'query-id' })

    await expect(
      executeAthenaStartQuery({
        ...CONNECTION,
        queryString: 'SELECT * FROM events WHERE day = ?',
        executionParameters: ['2024-01-01'],
        resultReuseEnabled: true,
        resultReuseMaxAgeInMinutes: 30,
      })
    ).resolves.toEqual({ success: true, output: { queryExecutionId: 'query-id' } })

    expect(mocks.send.mock.calls[0][0].input).toEqual({
      QueryString: 'SELECT * FROM events WHERE day = ?',
      ExecutionParameters: ['2024-01-01'],
      ResultReuseConfiguration: {
        ResultReuseByAgeConfiguration: { Enabled: true, MaxAgeInMinutes: 30 },
      },
    })
  })

  it('omits result reuse configuration when the flag is not set', async () => {
    mocks.send.mockResolvedValue({ QueryExecutionId: 'query-id' })

    await executeAthenaStartQuery({ ...CONNECTION, queryString: 'SELECT 1' })

    expect(mocks.send.mock.calls[0][0].input).toEqual({ QueryString: 'SELECT 1' })
  })

  it('forwards an empty description on update named query so it can be cleared', async () => {
    mocks.send.mockResolvedValue({})

    await executeAthenaUpdateNamedQuery({
      ...CONNECTION,
      namedQueryId: 'named-query-id',
      name: 'renamed',
      queryString: 'SELECT 2',
      description: '',
    })

    expect(mocks.send.mock.calls[0][0].input).toEqual({
      NamedQueryId: 'named-query-id',
      Name: 'renamed',
      QueryString: 'SELECT 2',
      Description: '',
    })
  })

  it('flattens runtime statistics and nulls missing asynchronous sections', async () => {
    mocks.send.mockResolvedValue({
      QueryRuntimeStatistics: {
        Timeline: { TotalExecutionTimeInMillis: 1200, EngineExecutionTimeInMillis: 900 },
      },
    })

    await expect(
      executeAthenaGetQueryRuntimeStatistics({ ...CONNECTION, queryExecutionId: 'query-id' })
    ).resolves.toEqual({
      success: true,
      output: {
        queryExecutionId: 'query-id',
        timeline: {
          queryQueueTimeInMillis: null,
          servicePreProcessingTimeInMillis: null,
          queryPlanningTimeInMillis: null,
          engineExecutionTimeInMillis: 900,
          serviceProcessingTimeInMillis: null,
          totalExecutionTimeInMillis: 1200,
        },
        rowStatistics: { inputRows: null, inputBytes: null, outputRows: null, outputBytes: null },
        outputStage: null,
      },
    })
  })

  it('projects workgroup configuration into a flat output', async () => {
    mocks.send.mockResolvedValue({
      WorkGroup: {
        Name: 'primary',
        State: 'ENABLED',
        CreationTime: new Date(1_700_000_000_000),
        Configuration: {
          ResultConfiguration: {
            OutputLocation: 's3://bucket/results/',
            EncryptionConfiguration: { EncryptionOption: 'SSE_KMS', KmsKey: 'key-arn' },
          },
          EnforceWorkGroupConfiguration: true,
          BytesScannedCutoffPerQuery: 10_000_000,
          EngineVersion: {
            SelectedEngineVersion: 'AUTO',
            EffectiveEngineVersion: 'Athena engine version 3',
          },
        },
      },
    })

    await expect(
      executeAthenaGetWorkGroup({ ...CONNECTION, workGroup: 'primary' })
    ).resolves.toEqual({
      success: true,
      output: {
        name: 'primary',
        state: 'ENABLED',
        description: null,
        creationTime: 1_700_000_000_000,
        identityCenterApplicationArn: null,
        engineVersion: {
          selectedEngineVersion: 'AUTO',
          effectiveEngineVersion: 'Athena engine version 3',
        },
        outputLocation: 's3://bucket/results/',
        encryptionOption: 'SSE_KMS',
        kmsKey: 'key-arn',
        expectedBucketOwner: null,
        managedQueryResultsEnabled: null,
        enforceWorkGroupConfiguration: true,
        publishCloudWatchMetricsEnabled: null,
        bytesScannedCutoffPerQuery: 10_000_000,
        requesterPaysEnabled: null,
        enableMinimumEncryptionConfiguration: null,
        executionRole: null,
      },
    })
  })

  it('maps prepared statements and unprocessed names from a batch get', async () => {
    mocks.send.mockResolvedValue({
      PreparedStatements: [
        {
          StatementName: 'daily_report',
          QueryStatement: 'SELECT 1',
          WorkGroupName: 'primary',
          LastModifiedTime: new Date(1_700_000_000_000),
        },
      ],
      UnprocessedPreparedStatementNames: [
        { StatementName: 'missing', ErrorCode: 'NOT_FOUND', ErrorMessage: 'not found' },
      ],
    })

    await expect(
      executeAthenaBatchGetPreparedStatement({
        ...CONNECTION,
        workGroup: 'primary',
        preparedStatementNames: ['daily_report', 'missing'],
      })
    ).resolves.toEqual({
      success: true,
      output: {
        preparedStatements: [
          {
            statementName: 'daily_report',
            queryStatement: 'SELECT 1',
            workGroupName: 'primary',
            description: null,
            lastModifiedTime: 1_700_000_000_000,
          },
        ],
        unprocessedPreparedStatementNames: [
          { statementName: 'missing', errorCode: 'NOT_FOUND', errorMessage: 'not found' },
        ],
      },
    })
  })
})
