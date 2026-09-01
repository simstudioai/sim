import { describe, expect, it } from 'vitest'
import { buildCanonicalIndex } from '@/lib/workflows/subblocks/visibility'
import { SnowflakeBlock } from '@/blocks/blocks/snowflake'
import type { SubBlockConfig } from '@/blocks/types'
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
  SNOWFLAKE_MAX_RESPONSE_BYTES,
  snowflakeAuthParamFields,
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

const snowflakeToolById = new Map(registeredSnowflakeTools().map((tool) => [tool.id, tool]))
const snowflakeOperationIds = (
  SnowflakeBlock.subBlocks.find((block) => block.id === 'operation')?.options ?? []
).map((option) => String(option.id))

/** The tool param a sub-block ultimately publishes under. */
const paramIdOf = (subBlock: SubBlockConfig) => subBlock.canonicalParamId ?? subBlock.id

/** Operations a sub-block is visible for, expanded from its condition. */
function conditionOperations(subBlock: SubBlockConfig): string[] {
  const condition = subBlock.condition
  if (!condition || typeof condition === 'function') return snowflakeOperationIds
  const value = condition.value
  const list = (Array.isArray(value) ? value : [value]).map(String)
  return condition.not ? snowflakeOperationIds.filter((op) => !list.includes(op)) : list
}

/** Operations a sub-block is required for. */
function requiredOperations(subBlock: SubBlockConfig): string[] {
  const required = subBlock.required
  if (required === true) return snowflakeOperationIds
  if (!required || typeof required !== 'object') return []
  const value = (required as { value: unknown }).value
  return (Array.isArray(value) ? value : [value]).map(String)
}

describe('Snowflake integration contracts', () => {
  it('keeps all 30 block operations aligned with registered tool IDs', () => {
    const tools = registeredSnowflakeTools()
    const operationBlock = SnowflakeBlock.subBlocks.find((block) => block.id === 'operation')
    const operationIds = operationBlock?.options?.map((option) => String(option.id)) ?? []
    const expectedToolIds = operationIds.map((operation) => `snowflake_${operation}`)

    expect(operationIds).toHaveLength(30)
    expect(SnowflakeBlock.tools.access).toEqual(expectedToolIds)
    expect(tools.map((tool) => tool.id).sort()).toEqual([...expectedToolIds].sort())
    for (const operation of operationIds) {
      expect(SnowflakeBlock.tools.config.tool({ operation })).toBe(`snowflake_${operation}`)
    }
  })

  it('keeps every canonical selector group well formed', () => {
    const ids = SnowflakeBlock.subBlocks.map((subBlock) => subBlock.id)
    expect(new Set(ids).size, 'duplicate sub-block id').toBe(ids.length)

    // A canonical id that also names a sub-block collides with its own group:
    // the serializer deletes member ids and republishes under the canonical id,
    // so the two would fight over the same key.
    for (const subBlock of SnowflakeBlock.subBlocks) {
      if (!subBlock.canonicalParamId) continue
      expect(ids, `${subBlock.id} canonical id collides with a sub-block id`).not.toContain(
        subBlock.canonicalParamId
      )
    }

    const groups = buildCanonicalIndex(SnowflakeBlock.subBlocks).groupsById
    // Each picker pairs one basic selector with one advanced text input, so a
    // value can always be typed or referenced when the picker cannot list it.
    // Both members must agree on condition and required, or the serializer's
    // basic/advanced swap would change when the field shows or blocks a run.
    for (const [canonicalId, group] of Object.entries(groups)) {
      expect(group.basicId, `${canonicalId} has no basic member`).toBeTruthy()
      expect(group.advancedIds, `${canonicalId} has no advanced member`).toHaveLength(1)
      const members = SnowflakeBlock.subBlocks.filter(
        (subBlock) => subBlock.canonicalParamId === canonicalId
      )
      expect(
        new Set(members.map((member) => JSON.stringify(member.required ?? null))).size,
        `${canonicalId} members disagree on required`
      ).toBe(1)
      expect(
        new Set(members.map((member) => JSON.stringify(member.condition ?? null))).size,
        `${canonicalId} members disagree on condition`
      ).toBe(1)
    }
    expect(Object.keys(groups).sort()).toEqual([
      'database',
      'fileFormat',
      'oauthCredential',
      'procedureName',
      'role',
      'schema',
      'table',
      'warehouse',
      'warehouseName',
    ])
  })

  it('every required tool param is required on the block for that operation', () => {
    const problems: string[] = []
    for (const op of snowflakeOperationIds) {
      const tool = snowflakeToolById.get(`snowflake_${op}`)
      for (const [name, cfg] of Object.entries<any>(tool.params ?? {})) {
        if (cfg.visibility === 'hidden' || !cfg.required) continue
        if (name === 'oauthCredential') continue
        const members = SnowflakeBlock.subBlocks.filter((sb) => paramIdOf(sb) === name)
        if (!members.length) {
          problems.push(`${tool.id}.${name}: no sub-block`)
          continue
        }
        const shown = members.filter((sb) => conditionOperations(sb).includes(op))
        if (!shown.length) problems.push(`${tool.id}.${name}: not shown for ${op}`)
        const required = shown.filter((sb) => requiredOperations(sb).includes(op))
        if (shown.length && !required.length)
          problems.push(`${tool.id}.${name}: not required for ${op}`)
      }
    }
    expect(problems).toEqual([])
  })

  it('no sub-block is shown for an operation whose tool does not accept it', () => {
    const skip = new Set(['operation', 'onErrorThreshold'])
    const problems: string[] = []
    for (const sb of SnowflakeBlock.subBlocks) {
      if (skip.has(sb.id)) continue
      const name = paramIdOf(sb)
      for (const op of conditionOperations(sb)) {
        const tool = snowflakeToolById.get(`snowflake_${op}`)
        if (!tool) {
          problems.push(`${sb.id}: unknown op ${op}`)
          continue
        }
        if (!(name in (tool.params ?? {})))
          problems.push(`${sb.id} shown for ${op} but ${tool.id} has no ${name}`)
      }
    }
    expect(problems).toEqual([])
  })

  it('block inputs and dependsOn reference real things', () => {
    const surfaces = new Set(SnowflakeBlock.subBlocks.map(paramIdOf))
    const orphanInputs = Object.keys(SnowflakeBlock.inputs).filter((k) => !surfaces.has(k))
    expect(orphanInputs).toEqual([])
    const ids = new Set(SnowflakeBlock.subBlocks.map((sb) => sb.id))
    const badDeps: string[] = []
    for (const sb of SnowflakeBlock.subBlocks) {
      for (const dep of (sb as any).dependsOn ?? []) {
        if (!ids.has(dep)) badDeps.push(`${sb.id} -> ${dep}`)
      }
    }
    expect(badDeps).toEqual([])
  })

  it('never hides a required field behind advanced mode', () => {
    const problems: string[] = []
    for (const subBlock of SnowflakeBlock.subBlocks) {
      if (!requiredOperations(subBlock).length) continue
      // A canonical pair always has a basic member, and a field gated behind an
      // advanced-only parent (onErrorThreshold under onError) cannot appear in
      // basic mode at all — neither is reachable-only-in-advanced.
      if (subBlock.canonicalParamId || (subBlock.required as { and?: unknown })?.and) continue
      if (subBlock.mode === 'advanced')
        problems.push(`${subBlock.id} is required but advanced-only`)
    }
    expect(problems).toEqual([])
  })

  it('every tool param declares required, visibility and description', () => {
    const problems: string[] = []
    for (const tool of registeredSnowflakeTools()) {
      for (const [name, cfg] of Object.entries<any>(tool.params ?? {})) {
        if (typeof cfg.required !== 'boolean') problems.push(`${tool.id}.${name} required`)
        if (!cfg.visibility) problems.push(`${tool.id}.${name} visibility`)
        if (!cfg.description) problems.push(`${tool.id}.${name} description`)
      }
      if (tool.version !== '1.0.0') problems.push(`${tool.id} version`)
      if (!tool.name?.startsWith('Snowflake ')) problems.push(`${tool.id} name`)
      if (!tool.description?.endsWith('.')) problems.push(`${tool.id} description`)
      if (!tool.outputs) problems.push(`${tool.id} outputs`)
    }
    expect(problems).toEqual([])
  })
  it('keeps tool parameters and outputs represented by the block contract', () => {
    for (const tool of registeredSnowflakeTools()) {
      expect(tool.params.oauthCredential).toMatchObject({
        required: true,
        visibility: 'user-only',
      })
      expect(tool.params).not.toHaveProperty('timeout')
      expect(tool.version).toBe('1.0.0')
      for (const [param, config] of Object.entries(tool.params)) {
        // Hidden params (accessToken, domain) are injected by the executor
        // from the selected credential, so they have no editor surface.
        if (config.visibility === 'hidden') continue
        expect(SnowflakeBlock.inputs, `${tool.id}.${param} block input`).toHaveProperty(param)
        // A param is surfaced either by a sub-block of the same id or by a
        // basic/advanced pair republishing under that canonical id.
        expect(
          SnowflakeBlock.subBlocks.some(
            (subBlock) => subBlock.id === param || subBlock.canonicalParamId === param
          ),
          `${tool.id}.${param} sub-block`
        ).toBe(true)
      }
      for (const output of Object.keys(tool.outputs ?? {})) {
        expect(SnowflakeBlock.outputs, `${tool.id}.${output} block output`).toHaveProperty(output)
      }
    }
  })

  it('declares every shared connection and session param identically across tools', () => {
    /**
     * The auth params come from a shared object; the session params are still
     * inlined per tool, matching the convention used by every other
     * integration. Duplication is only safe while the definitions stay
     * byte-identical, so pin them all here.
     */
    const shared = {
      ...snowflakeAuthParamFields,
      role: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Snowflake role to use for this statement',
      },
      statementTimeoutSeconds: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Statement timeout in seconds; 0 uses Snowflake maximum of 604800 seconds',
      },
      warehouse: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Warehouse to use for this statement; defaults to the PAT user setting',
      },
      maxRows: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Maximum result rows; defaults to 1000 with a Sim safety limit of 10000',
      },
    } as const

    const seen: Record<string, number> = {}
    for (const tool of registeredSnowflakeTools()) {
      for (const [name, expected] of Object.entries(shared)) {
        const param = tool.params[name]
        if (!param) continue
        seen[name] = (seen[name] ?? 0) + 1
        expect(param, `${tool.id}.${name}`).toEqual(expected)
      }
    }

    expect(seen).toEqual({
      oauthCredential: 30,
      accessToken: 30,
      domain: 30,
      role: 28,
      statementTimeoutSeconds: 28,
      warehouse: 15,
      maxRows: 7,
    })
  })

  it('coerces every non-string tool param of the selected operation and nothing else', () => {
    const mapParams = SnowflakeBlock.tools.config.params
    if (!mapParams) throw new Error('Snowflake block must map tool parameters')
    const operationBlock = SnowflakeBlock.subBlocks.find((block) => block.id === 'operation')
    const operationIds = operationBlock?.options?.map((option) => String(option.id)) ?? []
    /** Param types the block must convert from the string a text sub-block emits. */
    const coercedTypes = new Set(['number', 'json', 'array', 'object'])
    const inputs: Record<string, unknown> = {
      statementTimeoutSeconds: '60',
      maxRows: '100',
      partition: '1',
      partitionCount: '2',
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
      maxFileSizeBytes: '16000000',
      autoSuspendSeconds: '600',
      header: true,
      overwrite: true,
      singleFile: true,
      autoResume: true,
    }

    let coveredCoercions = 0
    for (const operation of operationIds) {
      const toolId = `snowflake_${operation}`
      const tool = registeredSnowflakeTools().find((candidate) => candidate.id === toolId)
      if (!tool) throw new Error(`Missing Snowflake tool ${toolId}`)
      const mapped = mapParams({ operation, ...inputs })

      const unexpected = Object.entries(mapped)
        .filter(([key, value]) => !(key in tool.params) && value !== undefined)
        .map(([key]) => key)
      expect(unexpected, `${toolId} returned params the tool does not accept`).toEqual([])

      const expectedCoercions = Object.entries(tool.params)
        .filter(([key, param]) => coercedTypes.has(param.type) && typeof inputs[key] === 'string')
        .map(([key]) => key)
      coveredCoercions += expectedCoercions.length
      for (const key of expectedCoercions) {
        expect(mapped, `${toolId}.${key} must be coerced by the block`).toHaveProperty(key)
        expect(typeof mapped[key], `${toolId}.${key} must not stay a raw string`).not.toBe('string')
        expect(mapped[key], `${toolId}.${key} must not be dropped`).toBeDefined()
      }
    }

    expect(coveredCoercions, 'coercion fixture must exercise every coerced tool param').toBe(54)

    expect(
      mapParams({ operation: 'load_data', onError: 'SKIP_FILE_PERCENT', onErrorThreshold: '5' })
    ).toMatchObject({ onError: 'SKIP_FILE_5%', onErrorThreshold: undefined })
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
      domain: 'acme.snowflakecomputing.com',
      accessToken: ' secret ',
    })
    expect(snowflakeHeaders).toMatchObject({
      Authorization: 'Bearer secret',
      'X-Snowflake-Authorization-Token-Type': 'PROGRAMMATIC_ACCESS_TOKEN',
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'Sim/1.0 (+https://sim.ai)',
    })
  })

  it('keeps statement timeout in the Snowflake body, not the HTTP transport', () => {
    const prepared = prepareToolRequest(executeSqlTool, {
      domain: 'acme.snowflakecomputing.com',
      accessToken: 'secret',
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
          domain: 'acme.snowflakecomputing.com',
          accessToken: 'secret',
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
    const auth = { domain: 'acme.snowflakecomputing.com', accessToken: 'secret' }
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
        domain: 'acme.snowflakecomputing.com',
        accessToken: 'secret',
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
        domain: 'acme.snowflakecomputing.com',
        accessToken: 'secret',
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
        domain: 'acme.snowflakecomputing.com',
        accessToken: 'secret',
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
      domain: 'acme.snowflakecomputing.com',
      accessToken: 'secret',
      statementHandle: 'handle',
      partition: 0,
    })

    expect(transformed?.output.result).toMatchObject({
      rows: [['1'], ['2'], ['3']],
      totalRows: 5,
      currentPartition: 0,
      partitionCount: 2,
      nextPartition: 1,
      truncated: true,
    })
    expect(transformed?.output.result).not.toHaveProperty('partitions')
  })

  it('never claims completeness for a metadata-less partition response', async () => {
    const metadatalessPartition = { statementHandle: 'handle', data: [['2']] }

    const unknown = await readSnowflakeResult(jsonResponse(metadatalessPartition), {
      currentPartition: 1,
    })
    expect(unknown.result).toEqual({
      columns: null,
      rows: [['2']],
      totalRows: null,
      currentPartition: 1,
      partitionCount: null,
      nextPartition: null,
      truncated: null,
    })

    const middle = await readSnowflakeResult(jsonResponse(metadatalessPartition), {
      currentPartition: 1,
      partitionCount: 3,
    })
    expect(middle.result).toMatchObject({
      currentPartition: 1,
      partitionCount: 3,
      nextPartition: 2,
      truncated: true,
    })

    const last = await readSnowflakeResult(jsonResponse(metadatalessPartition), {
      currentPartition: 2,
      partitionCount: 3,
    })
    expect(last.result).toMatchObject({
      currentPartition: 2,
      partitionCount: 3,
      nextPartition: null,
      truncated: false,
    })
  })

  it('derives truncation only from partitionInfo, ignoring the deprecated SQL API signals', async () => {
    const linked = await readSnowflakeResult(
      jsonResponse(
        {
          code: '391908',
          statementHandle: 'single-partition',
          data: [['1']],
          resultSetMetaData: { numRows: 1, partitionInfo: [{ rowCount: 1 }] },
        },
        200,
        { Link: '</api/v2/statements/single-partition?partition=1>; rel="next"' }
      )
    )
    expect(linked.result).toMatchObject({ nextPartition: null, truncated: false })
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

    const topLevelDml = await readSnowflakeResult(
      jsonResponse({
        statementHandle: 'dml',
        stats: {
          numRowsInserted: 2,
          numRowsUpdated: 1,
          numRowsDeleted: 3,
          numDuplicateRowsUpdated: 1,
        },
        resultSetMetaData: { rowType: [{ name: 'number of rows inserted', type: 'fixed' }] },
      })
    )
    expect(topLevelDml.dml).toEqual({
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
        domain: 'acme.snowflakecomputing.com',
        accessToken: 'secret',
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
        domain: 'acme.snowflakecomputing.com',
        accessToken: 'secret',
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
          domain: 'acme.snowflakecomputing.com',
          accessToken: 'secret',
          statementHandle: 'cancel-handle',
        }
      )
    ).rejects.toThrow('SQLSTATE 42000')

    const alreadyFinished = await cancelStatementTool.transformResponse?.(
      jsonResponse({
        statementHandle: 'cancel-handle',
        code: '000000',
        sqlState: '00000',
        message: 'Statement executed successfully',
      }),
      {
        domain: 'acme.snowflakecomputing.com',
        accessToken: 'secret',
        statementHandle: 'cancel-handle',
      }
    )
    expect(alreadyFinished?.output).toMatchObject({
      statementHandle: 'cancel-handle',
      status: 'SUCCEEDED',
    })
  })

  it('rejects error bodies without a SQLSTATE and never lets a SQLSTATE launder an error status', async () => {
    await expect(
      readSnowflakeResult(
        jsonResponse({ code: '390318', message: 'Authentication token has expired' }, 401)
      )
    ).rejects.toThrow('Snowflake statement failed (HTTP 401, 390318)')

    await expect(
      readSnowflakeResult(
        jsonResponse(
          {
            statementHandle: 'timed-out',
            code: '000000',
            sqlState: '00000',
            message: 'The execution of the statement was cancelled',
          },
          408
        )
      )
    ).rejects.toThrow('Snowflake statement failed (HTTP 408, SQLSTATE 00000, 000000)')

    await expect(
      readSnowflakeResult(jsonResponse({ statementHandle: 'server-error', sqlState: '' }, 500))
    ).rejects.toThrow('Snowflake statement failed (HTTP 500, SQLSTATE )')

    await expect(
      cancelStatementTool.transformResponse?.(
        jsonResponse({ statementHandle: 'cancel-handle', sqlState: '57014' }, 408),
        {
          domain: 'acme.snowflakecomputing.com',
          accessToken: 'secret',
          statementHandle: 'cancel-handle',
        }
      )
    ).rejects.toThrow('Snowflake statement failed (HTTP 408, SQLSTATE 57014)')
  })

  it('caps the response body size on both the declared and streamed paths', async () => {
    /**
     * Pinned to a literal: every other assertion here derives its fixture from the
     * constant, so raising the ceiling would otherwise leave the suite green.
     */
    expect(SNOWFLAKE_MAX_RESPONSE_BYTES).toBe(10 * 1024 * 1024)

    await expect(
      readSnowflakeResult(
        jsonResponse({ statementHandle: 'huge' }, 200, {
          'Content-Length': String(SNOWFLAKE_MAX_RESPONSE_BYTES + 1),
        })
      )
    ).rejects.toThrow('Snowflake response body exceeds maximum size')

    let emittedBytes = 0
    let canceled = false
    const chunk = new Uint8Array(1024 * 1024)
    chunk.fill(0x20)
    const chunked = new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          if (emittedBytes >= SNOWFLAKE_MAX_RESPONSE_BYTES * 1.5) {
            controller.close()
            return
          }
          emittedBytes += chunk.byteLength
          controller.enqueue(chunk)
        },
        cancel() {
          canceled = true
        },
      }),
      { headers: { 'Content-Type': 'application/json' } }
    )
    expect(chunked.headers.get('content-length')).toBeNull()

    await expect(readSnowflakeResult(chunked)).rejects.toThrow(
      'Snowflake response body exceeds maximum size'
    )
    expect(canceled).toBe(true)
    expect(emittedBytes).toBeLessThan(SNOWFLAKE_MAX_RESPONSE_BYTES * 2)
  })

  it('rejects session-context names that are not Snowflake identifiers', () => {
    const auth = { domain: 'acme.snowflakecomputing.com', accessToken: 'secret' }
    const spec = { statement: 'SELECT 1' }
    expect(() => buildSnowflakeStatementBody({ ...auth, role: 'ACCOUNTADMIN; --' }, spec)).toThrow(
      'Snowflake role must be an unquoted identifier'
    )
    expect(() => buildSnowflakeStatementBody(auth, spec, { warehouse: 'compute wh' })).toThrow(
      'Snowflake warehouse must be an unquoted identifier'
    )
    expect(() =>
      buildSnowflakeStatementBody(auth, spec, { context: { database: 'ANALYTICS.PUBLIC' } })
    ).toThrow('Snowflake database must be an unquoted identifier')
    expect(() =>
      buildSnowflakeStatementBody(auth, spec, { context: { schema: '"unterminated' } })
    ).toThrow('Snowflake schema must be an unquoted identifier')
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
        partitionCount: 2,
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
      domain: 'acme.snowflakecomputing.com',
      accessToken: 'secret',
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
