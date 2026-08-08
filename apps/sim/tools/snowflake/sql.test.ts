import { describe, expect, it } from 'vitest'
import { SnowflakeBlock } from '@/blocks/blocks/snowflake'
import {
  buildCallProcedure,
  buildCancelTaskRun,
  buildDeleteRows,
  buildGetTask,
  buildGetTaskRun,
  buildGetTaskRunOutput,
  buildGetWarehouse,
  buildInsertRows,
  buildIntrospectSchema,
  buildListTaskRuns,
  buildListTasks,
  buildListWarehouses,
  buildLoadData,
  buildResumeWarehouse,
  buildRunTask,
  buildSuspendWarehouse,
  buildUpdateRows,
  buildUpsertRows,
  identifier,
  normalizeBindings,
  qualifiedIdentifier,
} from '@/tools/snowflake/sql'

const context = { host: 'acme.snowflakecomputing.com', apiKey: 'secret' }
const table = { ...context, database: 'ANALYTICS', schema: 'PUBLIC', table: 'EVENTS' }
const queryId = '01b71944-0301-b428-0000-69f706bf0001'

describe('Snowflake SQL builders', () => {
  it('accepts safe identifiers and rejects SQL fragments', () => {
    expect(identifier('safe_name')).toBe('safe_name')
    expect(identifier('"Case Sensitive"')).toBe('"Case Sensitive"')
    expect(qualifiedIdentifier('DB', 'SCHEMA', 'TABLE')).toBe('DB.SCHEMA.TABLE')
    expect(() => identifier('users; DROP TABLE users')).toThrow('Invalid Snowflake identifier')
  })

  it('validates explicit bindings', () => {
    expect(normalizeBindings({ '1': { type: 'DATE', value: '2026-01-01' } })).toEqual({
      '1': { type: 'DATE', value: '2026-01-01' },
    })
    expect(() => normalizeBindings({ '0': { type: 'TEXT', value: 'x' } })).toThrow('positive')
    expect(() => normalizeBindings({ '1': { type: 'NOPE', value: 'x' } } as never)).toThrow(
      'Unsupported'
    )
    const largeValue = 'x'.repeat(1024 * 1024 + 1)
    expect(
      normalizeBindings({ '1': { type: 'TEXT', value: largeValue } })?.['1'].value
    ).toHaveLength(largeValue.length)
    expect(SnowflakeBlock.inputs.bindings.description).toContain(
      'object keyed by 1-based positions'
    )
    expect(SnowflakeBlock.inputs.procedureArguments.description).toContain('ordered JSON array')
  })

  it('parses JSON block inputs above the former Snowflake-specific byte limit', () => {
    const mapParams = SnowflakeBlock.tools.config.params
    if (!mapParams) throw new Error('Snowflake block must map tool parameters')
    const payload = 'x'.repeat(1024 * 1024 + 1)
    const result = mapParams({
      operation: 'insert_rows',
      rows: `[{"payload":"${payload}"}]`,
    }) as { rows: Array<{ payload: string }> }
    expect(result.rows[0].payload).toHaveLength(payload.length)
  })

  it('only coerces fields used by the selected block operation', () => {
    const mapParams = SnowflakeBlock.tools.config.params
    if (!mapParams) throw new Error('Snowflake block must map tool parameters')

    expect(() =>
      mapParams({
        operation: 'execute_sql',
        rows: '{invalid',
        filters: '{invalid',
        procedureArguments: '{invalid',
        onError: 'SKIP_FILE_NUMBER',
      })
    ).not.toThrow()
    expect(() =>
      mapParams({
        operation: 'delete_rows',
        rows: '{invalid',
        filters: '{"id":1}',
      })
    ).not.toThrow()
    expect(() =>
      mapParams({
        operation: 'load_data',
        onError: 'SKIP_FILE_NUMBER',
      })
    ).toThrow('threshold')
  })

  it('maps overlapping block fields according to the selected operation', () => {
    const mapParams = SnowflakeBlock.tools.config.params
    if (!mapParams) throw new Error('Snowflake block must map tool parameters')
    const finalParams = (params: Record<string, unknown>) => ({
      ...params,
      ...mapParams(params),
    })
    const staleFields = {
      database: 'OBJECT_DB',
      schema: 'OBJECT_SCHEMA',
      contextDatabase: 'CONTEXT_DB',
      contextSchema: 'CONTEXT_SCHEMA',
      taskName: 'TASK_DEFINITION',
      taskNameFilter: 'TASK_HISTORY_FILTER',
    }

    expect(finalParams({ operation: 'execute_sql', ...staleFields })).toMatchObject({
      database: 'CONTEXT_DB',
      schema: 'CONTEXT_SCHEMA',
    })
    expect(finalParams({ operation: 'insert_rows', ...staleFields, rows: '[]' })).toMatchObject({
      database: 'OBJECT_DB',
      schema: 'OBJECT_SCHEMA',
    })
    expect(finalParams({ operation: 'list_task_runs', ...staleFields })).toMatchObject({
      database: 'CONTEXT_DB',
      schema: 'CONTEXT_SCHEMA',
      taskName: 'TASK_HISTORY_FILTER',
    })
    expect(finalParams({ operation: 'get_task', ...staleFields })).toMatchObject({
      database: 'OBJECT_DB',
      schema: 'OBJECT_SCHEMA',
      taskName: 'TASK_DEFINITION',
    })
  })

  it('builds a bound multi-row INSERT in stable column order', () => {
    const result = buildInsertRows({
      ...table,
      rows: [
        { id: 1, payload: { ok: true } },
        { id: 2, payload: null },
      ],
    })
    expect(result.statement).toBe(
      'INSERT INTO ANALYTICS.PUBLIC.EVENTS (id, payload) VALUES (?, PARSE_JSON(?)), (?, NULL)'
    )
    expect(result.bindings).toEqual({
      '1': { type: 'FIXED', value: '1' },
      '2': { type: 'TEXT', value: '{"ok":true}' },
      '3': { type: 'FIXED', value: '2' },
    })
  })

  it('builds update-only and upsert MERGE statements with bound values', () => {
    const params = { ...table, rows: [{ id: 1, name: 'Ada' }], matchColumns: ['ID'] }
    const update = buildUpdateRows(params)
    const upsert = buildUpsertRows(params)
    expect(update.statement).toContain('WHEN MATCHED THEN UPDATE SET target.name = source.name')
    expect(update.statement).not.toContain('WHEN NOT MATCHED')
    expect(upsert.statement).toContain('WHEN NOT MATCHED THEN INSERT (id, name)')
    expect(upsert.bindings).toEqual({
      '1': { type: 'FIXED', value: '1' },
      '2': { type: 'TEXT', value: 'Ada' },
    })
    expect(() => buildUpdateRows({ ...params, matchColumns: ['id', 'ID'] })).toThrow('duplicate')
    expect(() => buildUpdateRows({ ...params, matchColumns: ['id', 'name', 'extra'] })).toThrow(
      'cannot exceed'
    )
  })

  it('rejects malformed structured writes', () => {
    expect(() => buildInsertRows({ ...table, rows: [] })).toThrow('non-empty')
    expect(() => buildInsertRows({ ...table, rows: [{ id: 1 }, { other: 2 }] })).toThrow(
      'same columns'
    )
    expect(() => buildInsertRows({ ...table, rows: [{ id: 1 }, { ID: 2 }] })).toThrow(
      'same columns'
    )
    expect(() => buildInsertRows({ ...table, rows: [{ id: 1, ID: 2 }] })).toThrow(
      'duplicate Snowflake column identifiers'
    )
    expect(() => buildInsertRows({ ...table, rows: [{ ID: 1, '"ID"': 2 }] })).toThrow(
      'duplicate Snowflake column identifiers'
    )
    expect(() =>
      buildInsertRows({ ...table, rows: [{ id: Number.MAX_SAFE_INTEGER + 1 }] })
    ).toThrow('safe integers')
  })

  it('builds structured writes above the former 1000-row limit', () => {
    const result = buildInsertRows({
      ...table,
      rows: Array.from({ length: 1001 }, (_, id) => ({ id })),
    })
    expect(Object.keys(result.bindings ?? {})).toHaveLength(1001)
    expect(result.statement).toContain('VALUES (?)')
  })

  it('requires delete filters and binds every filter value', () => {
    expect(() => buildDeleteRows({ ...table, filters: {} })).toThrow('cannot be empty')
    expect(buildDeleteRows({ ...table, filters: { id: 7, deleted_at: null } })).toEqual({
      statement: 'DELETE FROM ANALYTICS.PUBLIC.EVENTS WHERE id = ? AND deleted_at IS NULL',
      bindings: { '1': { type: 'FIXED', value: '7' } },
    })
  })

  it('builds COPY INTO with the supported stage and copy options', () => {
    expect(
      buildLoadData({
        ...table,
        stagePath: '@RAW_STAGE/2026/08',
        fileFormat: 'ANALYTICS.PUBLIC.CSV_FORMAT',
        pattern: '.*[.]csv',
        onError: 'CONTINUE',
        purge: true,
        force: false,
        matchByColumnName: 'CASE_INSENSITIVE',
      }).statement
    ).toBe(
      "COPY INTO ANALYTICS.PUBLIC.EVENTS FROM @RAW_STAGE/2026/08 FILE_FORMAT = (FORMAT_NAME = 'ANALYTICS.PUBLIC.CSV_FORMAT') PATTERN = '.*[.]csv' ON_ERROR = 'CONTINUE' PURGE = TRUE FORCE = FALSE MATCH_BY_COLUMN_NAME = CASE_INSENSITIVE"
    )
    expect(() => buildLoadData({ ...table, stagePath: '@stage/path; DROP TABLE x' })).toThrow(
      'stagePath'
    )
    expect(
      buildLoadData({
        ...table,
        stagePath: '@"Raw Stage"/daily',
        fileFormat: 'ANALYTICS.PUBLIC."CSV Format"',
      }).statement
    ).toContain(
      `FROM @"Raw Stage"/daily FILE_FORMAT = (FORMAT_NAME = 'ANALYTICS.PUBLIC."CSV Format"')`
    )
    expect(
      buildLoadData({
        ...table,
        stagePath: '@ANALYTICS.PUBLIC.%EVENTS/daily',
        onError: 'SKIP_FILE_10',
      }).statement
    ).toContain("FROM @ANALYTICS.PUBLIC.%EVENTS/daily ON_ERROR = 'SKIP_FILE_10'")
    expect(
      buildLoadData({ ...table, stagePath: '@RAW_STAGE', onError: 'SKIP_FILE_25%' }).statement
    ).toContain("ON_ERROR = 'SKIP_FILE_25%'")
    expect(
      buildLoadData({ ...table, stagePath: '@RAW_STAGE', onError: 'SKIP_FILE_2.5%' }).statement
    ).toContain("ON_ERROR = 'SKIP_FILE_2.5%'")
    expect(() =>
      buildLoadData({ ...table, stagePath: '@RAW_STAGE', onError: 'SKIP_FILE_0%' })
    ).toThrow('onError')
  })

  it('builds warehouse statements', () => {
    expect(buildListWarehouses('ETL%').statement).toBe("SHOW WAREHOUSES LIKE 'ETL%'")
    expect(buildGetWarehouse({ ...context, warehouseName: 'ETL_WH' }).statement).toBe(
      `SHOW WAREHOUSES ->> SELECT * FROM $1 WHERE "name" = 'ETL_WH'`
    )
    expect(buildGetWarehouse({ ...context, warehouseName: `"etl_%'s"` }).statement).toBe(
      `SHOW WAREHOUSES ->> SELECT * FROM $1 WHERE "name" = 'etl_%''s'`
    )
    expect(buildResumeWarehouse({ ...context, warehouseName: 'ETL_WH' }).statement).toBe(
      'ALTER WAREHOUSE ETL_WH RESUME IF SUSPENDED'
    )
    expect(buildSuspendWarehouse({ ...context, warehouseName: 'ETL_WH' }).statement).toBe(
      'ALTER WAREHOUSE ETL_WH SUSPEND'
    )
  })

  it('builds task definition and execution statements', () => {
    const task = { ...context, database: 'ANALYTICS', schema: 'PUBLIC', taskName: 'DAILY_LOAD' }
    expect(buildListTasks({ ...task, limit: 25, nameLike: 'DAILY%' }).statement).toBe(
      "SHOW TASKS LIKE 'DAILY%' IN SCHEMA ANALYTICS.PUBLIC LIMIT 25"
    )
    expect(buildGetTask(task).statement).toBe('DESCRIBE TASK ANALYTICS.PUBLIC.DAILY_LOAD')
    expect(buildRunTask({ ...task, retryLast: true }).statement).toBe(
      'EXECUTE TASK ANALYTICS.PUBLIC.DAILY_LOAD RETRY LAST'
    )
  })

  it('builds bounded task history, run lookup, cancellation, and output statements', () => {
    const history = buildListTaskRuns({
      ...context,
      taskName: 'DAILY_LOAD',
      startTime: '2026-08-01T00:00:00Z',
      errorOnly: true,
      limit: 50,
    })
    expect(history.statement).toContain('RESULT_LIMIT => 50, ERROR_ONLY => TRUE')
    expect(history.bindings).toEqual({
      '1': { type: 'TEXT', value: 'DAILY_LOAD' },
      '2': { type: 'TEXT', value: '2026-08-01T00:00:00Z' },
    })
    const run = buildGetTaskRun({
      ...context,
      queryId,
      taskName: 'DAILY_LOAD',
      startTime: '2026-08-01T00:00:00Z',
    })
    expect(run.statement).toContain('TASK_NAME => ?')
    expect(run.statement).toContain('SCHEDULED_TIME_RANGE_START => TO_TIMESTAMP_LTZ(?)')
    expect(run.statement).toContain('WHERE QUERY_ID = ?')
    expect(run.bindings).toEqual({
      '1': { type: 'TEXT', value: 'DAILY_LOAD' },
      '2': { type: 'TEXT', value: '2026-08-01T00:00:00Z' },
      '3': { type: 'TEXT', value: queryId },
    })
    expect(buildCancelTaskRun({ ...context, queryId }).statement).toContain('SYSTEM$CANCEL_QUERY')
    expect(buildGetTaskRunOutput({ ...context, queryId }).statement).toContain('RESULT_SCAN')
    expect(() => buildGetTaskRun({ ...context, queryId: "x' OR TRUE" })).toThrow('UUID')
  })

  it('builds bound schema introspection and typed procedure calls', () => {
    const schema = buildIntrospectSchema({
      ...context,
      database: 'ANALYTICS',
      schema: 'PUBLIC',
      table: 'EVENTS',
    })
    expect(schema.statement).toContain('ANALYTICS.INFORMATION_SCHEMA.COLUMNS')
    expect(schema.statement).toContain("t.TABLE_TYPE = 'BASE TABLE'")
    expect(schema.bindings).toEqual({
      '1': { type: 'TEXT', value: 'PUBLIC' },
      '2': { type: 'TEXT', value: 'EVENTS' },
    })
    expect(
      buildIntrospectSchema({
        ...context,
        database: 'analytics',
        schema: 'public',
        table: 'events',
      }).bindings
    ).toEqual({
      '1': { type: 'TEXT', value: 'PUBLIC' },
      '2': { type: 'TEXT', value: 'EVENTS' },
    })
    expect(
      buildIntrospectSchema({
        ...context,
        database: '"Analytics DB"',
        schema: '"Mixed Schema"',
        table: '"events"',
      }).bindings
    ).toEqual({
      '1': { type: 'TEXT', value: 'Mixed Schema' },
      '2': { type: 'TEXT', value: 'events' },
    })

    expect(
      buildCallProcedure({
        ...context,
        database: 'ANALYTICS',
        schema: 'PUBLIC',
        procedureName: 'REFRESH_MODEL',
        procedureArguments: [
          { type: 'TEXT', value: 'daily' },
          { type: 'BOOLEAN', value: 'true' },
        ],
      })
    ).toEqual({
      statement: 'CALL ANALYTICS.PUBLIC.REFRESH_MODEL(?, ?)',
      bindings: {
        '1': { type: 'TEXT', value: 'daily' },
        '2': { type: 'BOOLEAN', value: 'true' },
      },
    })
    expect(() =>
      buildCallProcedure({
        ...context,
        database: 'ANALYTICS',
        schema: 'PUBLIC',
        procedureName: 'REFRESH_MODEL',
        procedureArguments: { type: 'TEXT', value: 'x' } as never,
      })
    ).toThrow('JSON array')
  })
})
