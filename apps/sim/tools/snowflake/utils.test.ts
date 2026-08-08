import { describe, expect, it } from 'vitest'
import * as snowflakeTools from '@/tools/snowflake'
import { cancelStatementTool } from '@/tools/snowflake/cancel_statement'
import { executeSqlTool } from '@/tools/snowflake/execute_sql'
import { getStatementTool } from '@/tools/snowflake/get_statement'
import { listTaskRunsTool } from '@/tools/snowflake/list_task_runs'
import { listTasksTool } from '@/tools/snowflake/list_tasks'
import { SNOWFLAKE_STATEMENT_OUTPUTS } from '@/tools/snowflake/types'
import {
  buildSnowflakeStatementBody,
  getSnowflakeHeaders,
  MAX_REQUEST_BYTES,
  MAX_RESPONSE_BYTES,
  normalizeMaxRows,
  normalizeSnowflakeHost,
  transformSnowflakeResponse,
} from '@/tools/snowflake/utils'
import type { ToolConfig } from '@/tools/types'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('Snowflake SQL API transport', () => {
  it('declares all 21 operations as complete standard tool configurations', () => {
    const tools = Object.values(snowflakeTools).filter(
      (value): value is ToolConfig =>
        typeof value === 'object' && value !== null && 'id' in value && 'request' in value
    )
    const operationParams: Record<string, string[]> = {
      snowflake_call_procedure: ['procedureName', 'procedureArguments'],
      snowflake_cancel_statement: ['statementHandle'],
      snowflake_cancel_task_run: ['queryId'],
      snowflake_delete_rows: ['table', 'filters'],
      snowflake_execute_sql: ['statement', 'bindings', 'async'],
      snowflake_get_statement: ['statementHandle', 'partition', 'maxRows'],
      snowflake_get_task: ['taskName'],
      snowflake_get_task_run: ['queryId', 'taskName', 'startTime', 'endTime'],
      snowflake_get_task_run_output: ['queryId'],
      snowflake_get_warehouse: ['warehouseName'],
      snowflake_insert_rows: ['table', 'rows'],
      snowflake_introspect_schema: ['table', 'includeViews'],
      snowflake_list_task_runs: ['taskName', 'startTime', 'endTime', 'errorOnly', 'limit'],
      snowflake_list_tasks: ['nameLike', 'limit'],
      snowflake_list_warehouses: ['nameLike'],
      snowflake_load_data: [
        'table',
        'stagePath',
        'fileFormat',
        'pattern',
        'onError',
        'purge',
        'force',
        'matchByColumnName',
      ],
      snowflake_resume_warehouse: ['warehouseName'],
      snowflake_run_task: ['taskName', 'retryLast'],
      snowflake_suspend_warehouse: ['warehouseName'],
      snowflake_update_rows: ['table', 'rows', 'matchColumns'],
      snowflake_upsert_rows: ['table', 'rows', 'matchColumns'],
    }
    const baseParams = ['host', 'apiKey']
    const contextParams = ['warehouse', 'database', 'schema', 'role', 'timeout', 'maxRows']

    expect(tools.map((tool) => tool.id).sort()).toEqual(Object.keys(operationParams).sort())
    for (const tool of tools) {
      const expectedParams = [
        ...baseParams,
        ...(tool.id === 'snowflake_get_statement' || tool.id === 'snowflake_cancel_statement'
          ? []
          : contextParams),
        ...operationParams[tool.id],
      ]
      expect(Object.keys(tool.params).sort()).toEqual([...new Set(expectedParams)].sort())
      expect(tool.params.host).toMatchObject({ required: true, visibility: 'user-only' })
      expect(tool.params.apiKey).toMatchObject({ required: true, visibility: 'user-only' })
      expect(tool.request.url).toBeTypeOf('function')
      expect(tool.request.method).toBe(tool.id === 'snowflake_get_statement' ? 'GET' : 'POST')
      expect(tool.request.headers).toBeTypeOf('function')
      expect(tool.transformResponse).toBeTypeOf('function')
      expect(tool.outputs).toBe(SNOWFLAKE_STATEMENT_OUTPUTS)
      expect(tool.version).toBe('1.0.0')

      if (tool.id === 'snowflake_get_statement' || tool.id === 'snowflake_cancel_statement') {
        expect(tool.request.body).toBeUndefined()
      } else {
        expect(tool.request.body).toBeTypeOf('function')
      }
    }

    const toolsById = Object.fromEntries(tools.map((tool) => [tool.id, tool]))
    const urlParams = {
      host: 'acme.snowflakecomputing.com',
      apiKey: 'token',
      statementHandle: 'statement-handle',
      partition: 2,
      async: true,
    }
    const resolveUrl = (id: string) =>
      (toolsById[id].request.url as unknown as (params: typeof urlParams) => string)(urlParams)

    expect(resolveUrl('snowflake_get_statement')).toBe(
      'https://acme.snowflakecomputing.com/api/v2/statements/statement-handle?partition=2'
    )
    expect(resolveUrl('snowflake_cancel_statement')).toBe(
      'https://acme.snowflakecomputing.com/api/v2/statements/statement-handle/cancel'
    )
    expect(resolveUrl('snowflake_execute_sql')).toBe(
      'https://acme.snowflakecomputing.com/api/v2/statements?async=true'
    )
    for (const tool of tools) {
      if (
        tool.id !== 'snowflake_get_statement' &&
        tool.id !== 'snowflake_cancel_statement' &&
        tool.id !== 'snowflake_execute_sql'
      ) {
        expect(resolveUrl(tool.id)).toBe('https://acme.snowflakecomputing.com/api/v2/statements')
      }
    }

    expect(toolsById.snowflake_list_tasks.params.database.required).toBe(true)
    expect(toolsById.snowflake_list_tasks.params.schema.required).toBe(true)
  })

  it('normalizes Snowflake account hosts and rejects untrusted destinations', () => {
    expect(normalizeSnowflakeHost('acme-prod.snowflakecomputing.com')).toBe(
      'https://acme-prod.snowflakecomputing.com'
    )
    expect(normalizeSnowflakeHost('https://acme-prod.snowflakecomputing.cn')).toBe(
      'https://acme-prod.snowflakecomputing.cn'
    )
    expect(() => normalizeSnowflakeHost('http://acme.snowflakecomputing.com')).toThrow('HTTPS')
    expect(() => normalizeSnowflakeHost('snowflakecomputing.com.evil.test')).toThrow(
      'account hostname'
    )
    expect(() => normalizeSnowflakeHost('https://user@acme.snowflakecomputing.com')).toThrow(
      'only the account hostname'
    )
    expect(() => normalizeSnowflakeHost('acme.snowflakecomputing.com/api')).toThrow(
      'only the account hostname'
    )
  })

  it('sets PAT-specific authorization headers', () => {
    expect(
      getSnowflakeHeaders({ host: 'acme.snowflakecomputing.com', apiKey: ' secret ' })
    ).toMatchObject({
      Authorization: 'Bearer secret',
      'X-Snowflake-Authorization-Token-Type': 'PROGRAMMATIC_ACCESS_TOKEN',
      Accept: 'application/json',
      'Content-Type': 'application/json',
    })
    expect(() => getSnowflakeHeaders({ host: 'acme.snowflakecomputing.com', apiKey: ' ' })).toThrow(
      'token is required'
    )
  })

  it('uses the documented submit, status, partition, and cancel endpoints', () => {
    const auth = { host: 'acme.snowflakecomputing.com', apiKey: 'secret' }
    const executeUrl = executeSqlTool.request.url
    const getUrl = getStatementTool.request.url
    const cancelUrl = cancelStatementTool.request.url
    if (
      typeof executeUrl !== 'function' ||
      typeof getUrl !== 'function' ||
      typeof cancelUrl !== 'function'
    ) {
      throw new Error('Snowflake tool URLs must be functions')
    }
    expect(executeUrl({ ...auth, statement: 'SELECT 1', async: true })).toBe(
      'https://acme.snowflakecomputing.com/api/v2/statements?async=true'
    )
    expect(getUrl({ ...auth, statementHandle: ' handle ', partition: 2 })).toBe(
      'https://acme.snowflakecomputing.com/api/v2/statements/handle?partition=2'
    )
    expect(cancelUrl({ ...auth, statementHandle: ' handle ' })).toBe(
      'https://acme.snowflakecomputing.com/api/v2/statements/handle/cancel'
    )
  })

  it('enforces result row and request byte limits', () => {
    expect(normalizeMaxRows()).toBe(1000)
    expect(normalizeMaxRows(10_000)).toBe(10_000)
    expect(() => normalizeMaxRows(10_001)).toThrow('between 1 and 10000')
    expect(() =>
      buildSnowflakeStatementBody(
        { host: 'acme.snowflakecomputing.com', apiKey: 'secret' },
        { statement: 'x'.repeat(MAX_REQUEST_BYTES) }
      )
    ).toThrow('exceeds')
  })

  it('builds a bounded SQL API request body with execution context and bindings', () => {
    expect(
      buildSnowflakeStatementBody(
        {
          host: 'acme.snowflakecomputing.com',
          apiKey: 'secret',
          warehouse: 'compute_wh',
          database: 'analytics',
          schema: '"Mixed Schema"',
          role: '"Analyst ""Plus"""',
          timeout: 30,
          maxRows: 25,
        },
        { statement: 'SELECT ?', bindings: { '1': { type: 'FIXED', value: '7' } } }
      )
    ).toEqual({
      statement: 'SELECT ?',
      timeout: 30,
      warehouse: 'COMPUTE_WH',
      database: 'ANALYTICS',
      schema: 'Mixed Schema',
      role: 'Analyst "Plus"',
      parameters: { rows_per_resultset: 25 },
      bindings: { '1': { type: 'FIXED', value: '7' } },
    })
  })

  it('uses list limits for the SQL API result-set cap when maxRows is omitted', () => {
    const auth = { host: 'acme.snowflakecomputing.com', apiKey: 'secret' }
    const listTasksBody = listTasksTool.request.body
    const listRunsBody = listTaskRunsTool.request.body
    if (typeof listTasksBody !== 'function' || typeof listRunsBody !== 'function') {
      throw new Error('Snowflake list tool request bodies must be functions')
    }
    expect(
      listTasksBody({ ...auth, database: 'ANALYTICS', schema: 'PUBLIC', limit: 5000 })
    ).toMatchObject({ parameters: { rows_per_resultset: 5000 } })
    expect(listRunsBody({ ...auth, limit: 2500 })).toMatchObject({
      parameters: { rows_per_resultset: 2500 },
    })
  })

  it('normalizes completed results, partitions, strings/nulls, and DML statistics', async () => {
    const result = await transformSnowflakeResponse(
      jsonResponse({
        statementHandle: 'handle',
        message: 'Statement executed successfully.',
        data: [
          ['1', null],
          ['2', 'x'],
        ],
        resultSetMetaData: {
          numRows: 4,
          rowType: [{ name: 'ID', type: 'fixed', precision: 38, scale: 0, nullable: false }],
          partitionInfo: [
            { rowCount: 2, compressedSize: 20, uncompressedSize: 40 },
            { rowCount: 2, compressedSize: 20, uncompressedSize: 40 },
          ],
          stats: {
            numRowsInserted: 2,
            numRowsUpdated: 1,
            numRowsDeleted: 3,
            numDuplicateRowsUpdated: 1,
          },
        },
      }),
      0,
      1
    )

    expect(result.output).toMatchObject({
      statementHandle: 'handle',
      status: 'SUCCEEDED',
      rows: [['1', null]],
      totalRows: 4,
      nextPartition: 1,
      truncated: true,
      rowsInserted: 2,
      rowsUpdated: 1,
      rowsDeleted: 3,
      duplicateRowsUpdated: 1,
      rowsAffected: 6,
    })
  })

  it.each([
    {
      columns: ['number of rows inserted'],
      row: ['3'],
      expected: { rowsInserted: 3, rowsAffected: 3 },
    },
    {
      columns: ['number of rows updated', 'number of multi-joined rows updated'],
      row: ['2', '1'],
      expected: { rowsUpdated: 2, duplicateRowsUpdated: 1, rowsAffected: 2 },
    },
    {
      columns: [
        'number of rows inserted',
        'number of rows updated',
        'number of multi-joined rows updated',
      ],
      row: ['1', '4', '2'],
      expected: {
        rowsInserted: 1,
        rowsUpdated: 4,
        duplicateRowsUpdated: 2,
        rowsAffected: 5,
      },
    },
    {
      columns: ['number of rows deleted'],
      row: ['7'],
      expected: { rowsDeleted: 7, rowsAffected: 7 },
    },
  ])('derives typed DML statistics from $columns', async ({ columns, row, expected }) => {
    const result = await transformSnowflakeResponse(
      jsonResponse({
        data: [row],
        resultSetMetaData: { rowType: columns.map((name) => ({ name, type: 'fixed' })) },
      })
    )
    expect(result.output).toMatchObject(expected)
  })

  it('sums loaded rows from canonical COPY results', async () => {
    const result = await transformSnowflakeResponse(
      jsonResponse({
        data: [
          ['one.csv', 'LOADED', '2'],
          ['two.csv', 'LOADED', '3'],
          ['three.csv', 'LOAD_FAILED', null],
        ],
        resultSetMetaData: {
          rowType: [
            { name: 'FILE', type: 'text' },
            { name: 'STATUS', type: 'text' },
            { name: 'ROWS_LOADED', type: 'fixed' },
          ],
        },
      })
    )
    expect(result.output).toMatchObject({ rowsInserted: 5, rowsAffected: 5 })
  })

  it('prefers metadata statistics over derived COPY counts', async () => {
    const result = await transformSnowflakeResponse(
      jsonResponse({
        data: [
          ['one.csv', 'LOADED', '2'],
          ['two.csv', 'LOADED', '3'],
          ['three.csv', 'LOAD_FAILED', null],
        ],
        resultSetMetaData: {
          rowType: [
            { name: 'file', type: 'text' },
            { name: 'status', type: 'text' },
            { name: 'rows_loaded', type: 'fixed' },
          ],
          stats: { numRowsInserted: 8, numRowsDeleted: 1 },
        },
      })
    )
    expect(result.output).toMatchObject({
      rowsInserted: 8,
      rowsDeleted: 1,
      rowsAffected: 9,
    })
  })

  it('fills missing metadata statistics from result columns', async () => {
    const result = await transformSnowflakeResponse(
      jsonResponse({
        data: [['5', '6', '1']],
        resultSetMetaData: {
          rowType: [
            { name: 'number of rows inserted', type: 'fixed' },
            { name: 'number of rows updated', type: 'fixed' },
            { name: 'number of multi-joined rows updated', type: 'fixed' },
          ],
          stats: { numRowsInserted: 2 },
        },
      })
    )
    expect(result.output).toMatchObject({
      rowsInserted: 2,
      rowsUpdated: 6,
      duplicateRowsUpdated: 1,
      rowsAffected: 8,
    })
  })

  it.each([
    {
      columns: ['number of rows inserted', 'label'],
      row: ['9', 'not a DML result'],
    },
    { columns: ['number of rows deleted'], row: ['-1'] },
    { columns: ['number of rows updated'], row: ['1.5'] },
    { columns: ['number of rows inserted'], row: ['9007199254740992'] },
  ])('does not derive statistics from invalid result data', async ({ columns, row }) => {
    const result = await transformSnowflakeResponse(
      jsonResponse({
        data: [row],
        resultSetMetaData: { rowType: columns.map((name) => ({ name, type: 'fixed' })) },
      })
    )
    expect(result.output).toMatchObject({
      rowsInserted: 0,
      rowsUpdated: 0,
      rowsDeleted: 0,
      duplicateRowsUpdated: 0,
      rowsAffected: 0,
    })
  })

  it('treats HTTP 202 with a statement handle as pending', async () => {
    const result = await transformSnowflakeResponse(
      jsonResponse({ statementHandle: 'handle', message: 'Running' }, 202)
    )
    expect(result.output.status).toBe('RUNNING')
  })

  it('treats HTTP 429 as a rate-limit error even when Snowflake returns a statement handle', async () => {
    await expect(
      transformSnowflakeResponse(
        jsonResponse({ statementHandle: 'handle', message: 'Too many requests' }, 429)
      )
    ).rejects.toThrow('Too many requests')
  })

  it('uses the documented Link header for subsequent partition pagination', async () => {
    const response = jsonResponse({ statementHandle: 'handle', data: [['next']] })
    response.headers.set(
      'Link',
      '</api/v2/statements/handle?partition=2>; rel="next", </api/v2/statements/handle?partition=3>; rel="last"'
    )
    const result = await transformSnowflakeResponse(response, 1, 100)
    expect(result.output).toMatchObject({ currentPartition: 1, nextPartition: 2, truncated: true })
  })

  it('marks Snowflake incomplete result-set responses as truncated', async () => {
    const result = await transformSnowflakeResponse(
      jsonResponse({ statementHandle: 'handle', code: '391908', data: [['partial']] })
    )
    expect(result.output).toMatchObject({ code: '391908', truncated: true })
  })

  it('rejects HTTP and SQL-level failures', async () => {
    await expect(
      transformSnowflakeResponse(jsonResponse({ message: 'Forbidden', code: '390100' }, 401))
    ).rejects.toThrow('Forbidden')
    await expect(
      transformSnowflakeResponse(
        jsonResponse({ sqlState: '42000', code: '001003', message: 'SQL compilation error' })
      )
    ).rejects.toThrow('SQLSTATE 42000')
    await expect(
      transformSnowflakeResponse(
        new Response('{}', { headers: { 'Content-Length': String(MAX_RESPONSE_BYTES + 1) } })
      )
    ).rejects.toThrow('response exceeds')
  })
})
