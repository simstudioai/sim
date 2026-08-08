import { describe, expect, it } from 'vitest'
import { SnowflakeBlock } from '@/blocks/blocks/snowflake'
import { prepareToolRequest } from '@/tools/request-transport'
import * as snowflakeTools from '@/tools/snowflake'
import { cancelStatementTool } from '@/tools/snowflake/cancel_statement'
import { executeSqlTool } from '@/tools/snowflake/execute_sql'
import { getStatementTool } from '@/tools/snowflake/get_statement'
import { insertRowsTool } from '@/tools/snowflake/insert_rows'
import { listTaskRunsTool } from '@/tools/snowflake/list_task_runs'
import { listTasksTool } from '@/tools/snowflake/list_tasks'
import {
  buildSnowflakeStatementBody,
  getSnowflakeHeaders,
  normalizeMaxRows,
  normalizeSnowflakeHost,
  readSnowflakeResult,
} from '@/tools/snowflake/utils'
import type { ToolConfig } from '@/tools/types'

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

function registeredSnowflakeTools(): ToolConfig[] {
  return Object.values(snowflakeTools).filter(
    (value): value is ToolConfig =>
      typeof value === 'object' && value !== null && 'id' in value && 'request' in value
  )
}

function mergedBlockInputs(inputs: Record<string, unknown>): Record<string, unknown> {
  const mapParams = SnowflakeBlock.tools.config.params
  if (!mapParams) throw new Error('Snowflake block must map tool parameters')
  return { ...inputs, ...mapParams(inputs) }
}

describe('Snowflake integration contracts', () => {
  it('keeps all 21 block operations aligned with registered tool IDs', () => {
    const tools = registeredSnowflakeTools()
    const operationBlock = SnowflakeBlock.subBlocks.find((block) => block.id === 'operation')
    const operationIds = operationBlock?.options?.map((option) => String(option.id)) ?? []
    const expectedToolIds = operationIds.map((operation) => `snowflake_${operation}`)

    expect(operationIds).toHaveLength(21)
    expect(SnowflakeBlock.tools.access).toEqual(expectedToolIds)
    expect(tools.map((tool) => tool.id).sort()).toEqual([...expectedToolIds].sort())
    for (const operation of operationIds) {
      expect(SnowflakeBlock.tools.config.tool({ operation })).toBe(`snowflake_${operation}`)
    }
  })

  it('keeps tool parameters and outputs represented by the block contract', () => {
    for (const tool of registeredSnowflakeTools()) {
      expect(tool.params.host).toMatchObject({ required: true, visibility: 'user-only' })
      expect(tool.params.apiKey).toMatchObject({ required: true, visibility: 'user-only' })
      expect(tool.params).not.toHaveProperty('timeout')
      expect(tool.version).toBe('1.0.0')
      for (const param of Object.keys(tool.params)) {
        expect(SnowflakeBlock.inputs, `${tool.id}.${param} block input`).toHaveProperty(param)
        expect(
          SnowflakeBlock.subBlocks.some((subBlock) => subBlock.id === param),
          `${tool.id}.${param} sub-block`
        ).toBe(true)
      }
      for (const output of Object.keys(tool.outputs ?? {})) {
        expect(SnowflakeBlock.outputs, `${tool.id}.${output} block output`).toHaveProperty(output)
      }
    }
  })

  it('only returns coercions used by the selected operation', () => {
    const mapParams = SnowflakeBlock.tools.config.params
    if (!mapParams) throw new Error('Snowflake block must map tool parameters')
    const operationBlock = SnowflakeBlock.subBlocks.find((block) => block.id === 'operation')
    const operationIds = operationBlock?.options?.map((option) => String(option.id)) ?? []
    const inputs = {
      statementTimeoutSeconds: '60',
      maxRows: '100',
      partition: '1',
      limit: '10',
      async: true,
      retryLast: true,
      errorOnly: true,
      includeViews: true,
      purge: true,
      force: true,
      bindings: '{"1":{"type":"TEXT","value":"x"}}',
      rows: '[{"id":1,"value":"x"}]',
      matchColumns: '["id"]',
      filters: '{"id":1}',
      procedureArguments: '[{"type":"TEXT","value":"x"}]',
      onError: 'CONTINUE',
      onErrorThreshold: '1',
    }

    for (const operation of operationIds) {
      const toolId = `snowflake_${operation}`
      const tool = registeredSnowflakeTools().find((candidate) => candidate.id === toolId)
      if (!tool) throw new Error(`Missing Snowflake tool ${toolId}`)
      const mapped = mapParams({ operation, ...inputs })
      expect(Object.keys(mapped).every((key) => key in tool.params)).toBe(true)
    }
  })

  it('uses native boolean switches and scopes the COPY threshold to Load Data', () => {
    const booleanInputs = [
      ['execute_sql', 'async'],
      ['load_data', 'purge'],
      ['load_data', 'force'],
      ['run_task', 'retryLast'],
      ['list_task_runs', 'errorOnly'],
      ['introspect_schema', 'includeViews'],
    ] as const
    for (const [operation, id] of booleanInputs) {
      const subBlock = SnowflakeBlock.subBlocks.find((candidate) => candidate.id === id)
      expect(subBlock?.type, id).toBe('switch')
      expect(subBlock?.options, id).toBeUndefined()
      expect(mergedBlockInputs({ operation, [id]: true })[id], id).toBe(true)
    }

    const threshold = SnowflakeBlock.subBlocks.find(
      (candidate) => candidate.id === 'onErrorThreshold'
    )
    const expectedRule = {
      field: 'operation',
      value: 'load_data',
      and: { field: 'onError', value: ['SKIP_FILE_NUMBER', 'SKIP_FILE_PERCENT'] },
    }
    expect(threshold?.condition).toEqual(expectedRule)
    expect(threshold?.required).toEqual(expectedRule)
  })

  it('uses one stable statement output contract for all operations', () => {
    const expectedOutputs = ['statementHandle', 'status', 'message', 'result', 'dml']
    expect(Object.keys(SnowflakeBlock.outputs)).toEqual(expectedOutputs)
    for (const tool of registeredSnowflakeTools()) {
      expect(Object.keys(tool.outputs ?? {}), tool.id).toEqual(expectedOutputs)
    }
  })
})

describe('Snowflake SQL API transport', () => {
  it('normalizes account hosts and sets PAT-specific headers', () => {
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

    const snowflakeHeaders = getSnowflakeHeaders({
      host: 'acme.snowflakecomputing.com',
      apiKey: ' secret ',
    })
    expect(snowflakeHeaders).toMatchObject({
      Authorization: 'Bearer secret',
      'X-Snowflake-Authorization-Token-Type': 'PROGRAMMATIC_ACCESS_TOKEN',
      Accept: 'application/json',
      'Content-Type': 'application/json',
    })
    expect(snowflakeHeaders).not.toHaveProperty('User-Agent')
  })

  it('keeps statement timeout in the Snowflake body, not the HTTP transport', () => {
    const prepared = prepareToolRequest(executeSqlTool, {
      host: 'acme.snowflakecomputing.com',
      apiKey: 'secret',
      statement: 'SELECT 1',
      statementTimeoutSeconds: 60,
    })

    expect(prepared.timeout).toBeUndefined()
    expect(JSON.parse(prepared.body ?? '{}')).toMatchObject({ timeout: 60 })
  })

  it('builds explicit execution context and bounded result settings', () => {
    expect(normalizeMaxRows()).toBe(1000)
    expect(normalizeMaxRows(10_000)).toBe(10_000)
    expect(() => normalizeMaxRows(10_001)).toThrow('Sim safety limit of 10000')

    expect(
      buildSnowflakeStatementBody(
        {
          host: 'acme.snowflakecomputing.com',
          apiKey: 'secret',
          role: '"Analyst ""Plus"""',
          statementTimeoutSeconds: 30,
        },
        { statement: 'SELECT ?', bindings: { '1': { type: 'FIXED', value: '7' } } },
        {
          context: { database: 'analytics', schema: '"Mixed Schema"' },
          warehouse: 'compute_wh',
          maxRows: 25,
        }
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

  it('uses list limits as the SQL API result bound', () => {
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

  it('ignores stale hidden capabilities after the real block input merge', () => {
    const listTasksBody = listTasksTool.request.body
    const insertRowsBody = insertRowsTool.request.body
    const executeBody = executeSqlTool.request.body
    if (
      typeof listTasksBody !== 'function' ||
      typeof insertRowsBody !== 'function' ||
      typeof executeBody !== 'function'
    ) {
      throw new Error('Snowflake statement request bodies must be functions')
    }

    const listTasks = listTasksBody(
      mergedBlockInputs({
        operation: 'list_tasks',
        host: 'acme.snowflakecomputing.com',
        apiKey: 'secret',
        database: 'ANALYTICS',
        schema: 'PUBLIC',
        limit: '25',
        maxRows: 'not-a-number',
        warehouse: 'STALE_WH',
      }) as never
    )
    expect(listTasks).toMatchObject({ parameters: { rows_per_resultset: 25 } })
    expect(listTasks).not.toHaveProperty('warehouse')

    const insertRows = insertRowsBody(
      mergedBlockInputs({
        operation: 'insert_rows',
        host: 'acme.snowflakecomputing.com',
        apiKey: 'secret',
        database: 'ANALYTICS',
        schema: 'PUBLIC',
        table: 'EVENTS',
        rows: '[{"id":1}]',
        maxRows: 'not-a-number',
      }) as never
    )
    expect(insertRows).toMatchObject({ parameters: { rows_per_resultset: 1000 } })

    const execute = executeBody(
      mergedBlockInputs({
        operation: 'execute_sql',
        host: 'acme.snowflakecomputing.com',
        apiKey: 'secret',
        statement: 'SELECT 1',
        warehouse: 'compute_wh',
        maxRows: '25',
      }) as never
    )
    expect(execute).toMatchObject({
      warehouse: 'COMPUTE_WH',
      parameters: { rows_per_resultset: 25 },
    })
  })

  it('returns the complete requested partition without client-side row slicing', async () => {
    const response = jsonResponse(
      {
        statementHandle: 'handle',
        data: [['1'], ['2'], ['3']],
        resultSetMetaData: {
          numRows: 5,
          rowType: [{ name: 'ID', type: 'fixed', nullable: false }],
          partitionInfo: [{ rowCount: 3 }, { rowCount: 2 }],
        },
      },
      200,
      {
        Link: '</api/v2/statements/handle?partition=1>; rel="next"',
      }
    )
    const transformed = await getStatementTool.transformResponse?.(response, {
      host: 'acme.snowflakecomputing.com',
      apiKey: 'secret',
      statementHandle: 'handle',
      partition: 0,
    })

    expect(transformed?.output.result).toMatchObject({
      rows: [['1'], ['2'], ['3']],
      totalRows: 5,
      currentPartition: 0,
      nextPartition: 1,
      truncated: true,
    })
    expect(transformed?.output.result).not.toHaveProperty('partitions')

    const capped = await readSnowflakeResult(
      jsonResponse({
        code: '391908',
        statementHandle: 'capped-handle',
        data: [['1']],
        resultSetMetaData: { numRows: 1, partitionInfo: [{ rowCount: 1 }] },
      })
    )
    expect(capped.result).toMatchObject({ nextPartition: null, truncated: true })
  })

  it('handles pending statements, documented DML stats, and Snowflake failures', async () => {
    const pending = await readSnowflakeResult(
      jsonResponse({ statementHandle: 'handle', message: 'Running' }, 202)
    )
    expect(pending).toEqual({
      statementHandle: 'handle',
      status: 'RUNNING',
      message: 'Running',
      result: null,
      dml: null,
    })
    await expect(readSnowflakeResult(jsonResponse({ message: 'Running' }, 202))).rejects.toThrow(
      'without a statement handle'
    )
    const knownPending = await readSnowflakeResult(jsonResponse({ message: 'Running' }, 202), {
      fallbackStatementHandle: 'known-handle',
    })
    expect(knownPending).toMatchObject({
      statementHandle: 'known-handle',
      status: 'RUNNING',
      result: null,
      dml: null,
    })

    const dml = await readSnowflakeResult(
      jsonResponse({
        statementHandle: 'dml',
        data: [['caption fallback is intentionally ignored']],
        resultSetMetaData: {
          rowType: [{ name: 'number of rows inserted', type: 'fixed' }],
          stats: {
            numRowsInserted: 2,
            numRowsUpdated: 1,
            numRowsDeleted: 3,
            numDuplicateRowsUpdated: 1,
          },
        },
      })
    )
    expect(dml.dml).toEqual({
      rowsInserted: 2,
      rowsUpdated: 1,
      rowsDeleted: 3,
      duplicateRowsUpdated: 1,
      rowsAffected: 6,
    })

    const zeroDml = await readSnowflakeResult(
      jsonResponse({ statementHandle: 'zero-dml', resultSetMetaData: { stats: {} } })
    )
    expect(zeroDml.dml).toEqual({
      rowsInserted: 0,
      rowsUpdated: 0,
      rowsDeleted: 0,
      duplicateRowsUpdated: 0,
      rowsAffected: 0,
    })

    await expect(
      readSnowflakeResult(
        jsonResponse({ sqlState: '42000', code: '001003', message: 'SQL compilation error' })
      )
    ).rejects.toThrow('SQLSTATE 42000')
    await expect(readSnowflakeResult(new Response('{invalid'))).rejects.toThrow('invalid JSON')
    await expect(readSnowflakeResult(new Response(''))).rejects.toThrow('invalid JSON')
    await expect(readSnowflakeResult(jsonResponse(null))).rejects.toThrow('invalid JSON')
    await expect(readSnowflakeResult(jsonResponse([]))).rejects.toThrow('invalid JSON')
  })

  it('returns async and cancellation states through the common contract', async () => {
    const pending = await executeSqlTool.transformResponse?.(
      jsonResponse({ statementHandle: 'async-handle', message: 'Running' }, 202),
      {
        host: 'acme.snowflakecomputing.com',
        apiKey: 'secret',
        statement: 'SELECT 1',
        async: true,
      }
    )
    expect(pending?.output).toEqual({
      statementHandle: 'async-handle',
      status: 'RUNNING',
      message: 'Running',
      result: null,
      dml: null,
    })

    const canceled = await cancelStatementTool.transformResponse?.(
      jsonResponse({ statementHandle: 'cancel-handle', sqlState: '57014', message: 'Canceled' }),
      {
        host: 'acme.snowflakecomputing.com',
        apiKey: 'secret',
        statementHandle: 'cancel-handle',
      }
    )
    expect(canceled?.output).toEqual({
      statementHandle: 'cancel-handle',
      status: 'CANCELED',
      message: 'Canceled',
      result: null,
      dml: null,
    })

    await expect(
      cancelStatementTool.transformResponse?.(
        jsonResponse({
          statementHandle: 'cancel-handle',
          sqlState: '42000',
          message: 'Unexpected cancellation failure',
        }),
        {
          host: 'acme.snowflakecomputing.com',
          apiKey: 'secret',
          statementHandle: 'cancel-handle',
        }
      )
    ).rejects.toThrow('SQLSTATE 42000')
  })
})

describe('Snowflake common result contract', () => {
  it('preserves raw Snowflake rows, exact numeric strings, and continuation metadata', async () => {
    const rows = [
      ['one.csv', 'LOADED', '9007199254740993'],
      ['two.csv', 'PARTIALLY_LOADED', '7'],
    ]
    const result = await readSnowflakeResult(
      jsonResponse(
        {
          code: '000000',
          sqlState: '00000',
          message: 'Statement executed successfully',
          statementHandle: 'copy',
          data: rows,
          resultSetMetaData: {
            numRows: 3,
            partitionInfo: [{ rowCount: 2 }, { rowCount: 1 }],
            rowType: ['FILE', 'STATUS', 'ROWS_LOADED'].map((name) => ({ name, type: 'text' })),
          },
        },
        200,
        { Link: '</api/v2/statements/copy?partition=1>; rel="next"' }
      )
    )

    expect(result).toMatchObject({
      statementHandle: 'copy',
      status: 'SUCCEEDED',
      message: 'Statement executed successfully',
      dml: null,
      result: {
        rows,
        totalRows: 3,
        currentPartition: 0,
        nextPartition: 1,
        truncated: true,
      },
    })
    expect(result).not.toHaveProperty('code')
    expect(result).not.toHaveProperty('sqlState')
    expect(result.result).not.toHaveProperty('partitions')
  })

  it('keeps submission and polling responses structurally identical', async () => {
    const body = {
      statementHandle: 'handle',
      data: [['value']],
      resultSetMetaData: {
        numRows: 1,
        rowType: [{ name: 'RESULT', type: 'text', nullable: true }],
        partitionInfo: [{ rowCount: 1, uncompressedSize: 10 }],
      },
    }
    const params = {
      host: 'acme.snowflakecomputing.com',
      apiKey: 'secret',
      statement: 'SELECT 1',
    }
    const submitted = await executeSqlTool.transformResponse?.(jsonResponse(body), params)
    const polled = await getStatementTool.transformResponse?.(jsonResponse(body), {
      ...params,
      statementHandle: 'handle',
      partition: 0,
    })

    expect(Object.keys(submitted?.output ?? {})).toEqual(Object.keys(polled?.output ?? {}))
    expect(submitted?.output).toEqual(polled?.output)
    expect(submitted?.output.result).toMatchObject({
      rows: [['value']],
      totalRows: 1,
      truncated: false,
    })
  })
})
