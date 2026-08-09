import { describe, expect, it } from 'vitest'
import { SnowflakeBlock } from '@/blocks/blocks/snowflake'
import {
  buildAlterWarehouse,
  buildCallProcedure,
  buildCancelTaskRun,
  buildDeleteRows,
  buildGetTask,
  buildGetTaskRun,
  buildGetTaskRunOutput,
  buildGetWarehouse,
  buildInsertRows,
  buildIntrospectSchema,
  buildListCopyHistory,
  buildListDatabases,
  buildListQueryHistory,
  buildListSchemas,
  buildListTables,
  buildListTaskRuns,
  buildListTasks,
  buildListWarehouses,
  buildLoadData,
  buildResumeTask,
  buildResumeWarehouse,
  buildRunTask,
  buildSuspendTask,
  buildSuspendWarehouse,
  buildUnloadData,
  buildUpdateRows,
  buildUpsertRows,
  identifier,
  normalizeBindings,
  qualifiedIdentifier,
} from '@/tools/snowflake/sql'

const context = { oauthCredential: 'cred-1' }
const table = { ...context, database: 'ANALYTICS', schema: 'PUBLIC', table: 'EVENTS' }
const queryId = '01b71944-0301-b428-0000-69f706bf0001'

/** ISO instants inside the history retention windows, so assertions never age out. */
const historyStart = new Date(Date.now() - 2 * 86_400_000).toISOString()
const historyEnd = new Date(Date.now() - 86_400_000).toISOString()
const copyStart = new Date(Date.now() - 3 * 86_400_000).toISOString()

/** The separator the row-shape and match-key encodings join on; legal inside a quoted identifier. */
const SEPARATOR = String.fromCharCode(0)

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
    expect(() => normalizeBindings([] as never)).toThrow('JSON object')
    expect(() => normalizeBindings({ '1': [] } as never)).toThrow('contain type and value')
    expect(SnowflakeBlock.inputs.bindings.description).toContain(
      'object keyed by 1-based positions'
    )
    expect(SnowflakeBlock.inputs.procedureArguments.description).toContain('ordered JSON array')
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
      taskName: 'TASK_DEFINITION',
    }

    expect(finalParams({ operation: 'execute_sql', ...staleFields })).toMatchObject({
      database: 'OBJECT_DB',
      schema: 'OBJECT_SCHEMA',
    })
    expect(finalParams({ operation: 'insert_rows', ...staleFields, rows: '[]' })).toMatchObject({
      database: 'OBJECT_DB',
      schema: 'OBJECT_SCHEMA',
    })
    expect(finalParams({ operation: 'list_task_runs', ...staleFields })).toMatchObject({
      taskName: 'TASK_DEFINITION',
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
        { id: 1, name: 'Ada' },
        { id: 2, name: null },
      ],
    })
    expect(result.statement).toBe(
      'INSERT INTO ANALYTICS.PUBLIC.EVENTS (id, name) VALUES (?, ?), (?, NULL)'
    )
    expect(result.bindings).toEqual({
      '1': { type: 'FIXED', value: '1' },
      '2': { type: 'TEXT', value: 'Ada' },
      '3': { type: 'FIXED', value: '2' },
    })
  })

  it('lifts PARSE_JSON out of the VALUES clause into a projecting SELECT', () => {
    const result = buildInsertRows({
      ...table,
      rows: [
        { id: 1, payload: { ok: true } },
        { id: 2, payload: null },
      ],
    })
    expect(result.statement).toBe(
      'INSERT INTO ANALYTICS.PUBLIC.EVENTS (id, payload) SELECT C1 AS id, PARSE_JSON(C2) AS payload FROM (VALUES (?, ?), (?, NULL)) AS v (C1, C2)'
    )
    expect(result.statement).not.toContain('VALUES (?, PARSE_JSON(?))')
    expect(result.bindings).toEqual({
      '1': { type: 'FIXED', value: '1' },
      '2': { type: 'TEXT', value: '{"ok":true}' },
      '3': { type: 'FIXED', value: '2' },
    })
  })

  it('projects semi-structured MERGE source columns outside the VALUES clause', () => {
    const upsert = buildUpsertRows({
      ...table,
      rows: [{ id: 1, payload: { ok: true } }],
      matchColumns: ['id'],
    })
    expect(upsert.statement).toContain(
      'USING (SELECT C1 AS id, PARSE_JSON(C2) AS payload FROM (VALUES (?, ?)) AS v (C1, C2)) AS source'
    )
    expect(upsert.statement).not.toContain('VALUES (?, PARSE_JSON(?))')
  })

  it('escapes both backslashes and quotes in string literals', () => {
    expect(
      buildLoadData({ ...table, stagePath: '@RAW_STAGE', pattern: '.*\\' }).statement
    ).toContain("PATTERN = '.*\\\\'")
    expect(buildListWarehouses("ETL\\' OR TRUE --").statement).toBe(
      "SHOW WAREHOUSES LIKE 'ETL\\\\'' OR TRUE --'"
    )
  })

  it('routes a mixed semi-structured column through a single whole-column PARSE_JSON', () => {
    const result = buildInsertRows({
      ...table,
      rows: [{ payload: 'text' }, { payload: { a: 1 } }],
    })
    expect(result.statement).toBe(
      'INSERT INTO ANALYTICS.PUBLIC.EVENTS (payload) SELECT PARSE_JSON(C1) AS payload FROM (VALUES (?), (?)) AS v (C1)'
    )
    expect(result.bindings).toEqual({
      '1': { type: 'TEXT', value: '"text"' },
      '2': { type: 'TEXT', value: '{"a":1}' },
    })
  })

  it('builds update-only and upsert MERGE statements with bound values', () => {
    const params = { ...table, rows: [{ id: 1, name: 'Ada' }], matchColumns: ['ID'] }
    const update = buildUpdateRows(params)
    const upsert = buildUpsertRows(params)
    expect(update.statement).toContain('ON target.id = source.id')
    expect(update.statement).not.toContain('EQUAL_NULL')
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
    expect(() => buildUpdateRows({ ...params, matchColumns: [7] as never })).toThrow(
      'column name string'
    )
  })

  it('rejects match keys a MERGE cannot resolve deterministically', () => {
    expect(() =>
      buildUpsertRows({
        ...table,
        rows: [
          { id: 1, name: 'Ada' },
          { id: 1, name: 'Grace' },
        ],
        matchColumns: ['id'],
      })
    ).toThrow('duplicate match key values for id: number:1')
    expect(() =>
      buildUpsertRows({
        ...table,
        rows: [{ id: null, name: 'Ada' }],
        matchColumns: ['id'],
      })
    ).toThrow('match column cannot be null in a row: id')
  })

  it('encodes composite match keys unambiguously across column boundaries', () => {
    expect(() =>
      buildUpsertRows({
        ...table,
        rows: [
          { a: 'p', b: `q${SEPARATOR}string:r`, c: 1 },
          { a: `p${SEPARATOR}string:q`, b: 'r', c: 2 },
        ],
        matchColumns: ['a', 'b'],
      })
    ).not.toThrow()
    expect(() =>
      buildUpsertRows({
        ...table,
        rows: [
          { a: '1', b: 'x', c: 1 },
          { a: 1, b: 'x', c: 2 },
        ],
        matchColumns: ['a', 'b'],
      })
    ).toThrow('duplicate match key values')
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
    expect(() =>
      buildInsertRows({
        ...table,
        rows: [{ [`"a${SEPARATOR}b"`]: 1 }, { '"a': 9, 'b"': 8 }],
      })
    ).toThrow('same columns')
    expect(() => buildInsertRows({ ...table, rows: [{ id: 1, name: 'a' }, { id: 2 }] })).toThrow(
      'same columns'
    )
  })

  it('requires delete filters and binds every filter value', () => {
    expect(() => buildDeleteRows({ ...table, filters: {} })).toThrow('cannot be empty')
    expect(() => buildDeleteRows({ ...table, filters: { id: 1, ID: 2 } })).toThrow(
      'duplicate Snowflake column identifiers'
    )
    expect(() => buildDeleteRows({ ...table, filters: { ID: 1, '"ID"': 2 } })).toThrow(
      'duplicate Snowflake column identifiers'
    )
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
      "COPY INTO ANALYTICS.PUBLIC.EVENTS FROM @RAW_STAGE/2026/08 PATTERN = '.*[.]csv' FILE_FORMAT = (FORMAT_NAME = 'ANALYTICS.PUBLIC.CSV_FORMAT') ON_ERROR = 'CONTINUE' PURGE = TRUE FORCE = FALSE MATCH_BY_COLUMN_NAME = CASE_INSENSITIVE"
    )
    expect(() =>
      buildLoadData({ ...table, stagePath: '@RAW_STAGE/--', pattern: '.*[.]csv' })
    ).toThrow('SQL line comment')
    expect(() => buildLoadData({ ...table, stagePath: '@RAW_STAGE/a--b/c' })).toThrow(
      'SQL line comment'
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
      buildLoadData({ ...table, stagePath: '@RAW_STAGE', onError: 'SKIP_FILE_25%' }).statement
    ).toContain("ON_ERROR = 'SKIP_FILE_25%'")
    expect(() =>
      buildLoadData({ ...table, stagePath: '@RAW_STAGE', onError: 'SKIP_FILE_2.5%' })
    ).toThrow('onError')
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

  it('bounds every object listing and scopes it to the requested container', () => {
    expect(buildListDatabases({ ...context, limit: 25 }).statement).toBe('SHOW DATABASES LIMIT 25')
    expect(buildListDatabases({ ...context, nameLike: "AN'X%" }).statement).toBe(
      "SHOW DATABASES LIKE 'AN''X%' LIMIT 1000"
    )
    expect(buildListSchemas({ ...context, database: 'ANALYTICS', limit: 5 }).statement).toBe(
      'SHOW SCHEMAS IN DATABASE ANALYTICS LIMIT 5'
    )
    expect(
      buildListTables({ ...context, database: 'ANALYTICS', schema: 'PUBLIC', nameLike: 'E%' })
        .statement
    ).toBe("SHOW TABLES LIKE 'E%' IN SCHEMA ANALYTICS.PUBLIC LIMIT 1000")
    expect(() => buildListTables({ ...context, database: 'A; DROP', schema: 'PUBLIC' })).toThrow(
      /Invalid Snowflake identifier/
    )
  })

  it('builds task state changes and rejects unqualifiable names', () => {
    const task = { ...context, database: 'ANALYTICS', schema: 'PUBLIC', taskName: 'DAILY_LOAD' }
    expect(buildResumeTask(task).statement).toBe('ALTER TASK ANALYTICS.PUBLIC.DAILY_LOAD RESUME')
    expect(buildSuspendTask(task).statement).toBe('ALTER TASK ANALYTICS.PUBLIC.DAILY_LOAD SUSPEND')
    expect(() => buildResumeTask({ ...task, taskName: 'A RESUME; DROP' })).toThrow(
      /Invalid Snowflake identifier/
    )
  })

  it('builds warehouse alterations and rejects unsupported settings', () => {
    expect(
      buildAlterWarehouse({
        ...context,
        warehouseName: 'ETL_WH',
        warehouseSize: 'xlarge',
        autoSuspendSeconds: 0,
        autoResume: false,
      }).statement
    ).toBe(
      'ALTER WAREHOUSE ETL_WH SET WAREHOUSE_SIZE = XLARGE AUTO_SUSPEND = 0 AUTO_RESUME = FALSE'
    )
    // Every documented spelling of a size normalizes to the bare keyword.
    for (const spelling of ['2X-LARGE', "'2X-LARGE'", 'X2LARGE', 'xxlarge']) {
      expect(
        buildAlterWarehouse({ ...context, warehouseName: 'ETL_WH', warehouseSize: spelling })
          .statement
      ).toBe('ALTER WAREHOUSE ETL_WH SET WAREHOUSE_SIZE = XXLARGE')
    }
    expect(() =>
      buildAlterWarehouse({ ...context, warehouseName: 'ETL_WH', warehouseSize: 'HUGE' })
    ).toThrow(/warehouseSize must be one of/)
    expect(() =>
      buildAlterWarehouse({ ...context, warehouseName: 'ETL_WH', autoSuspendSeconds: -1 })
    ).toThrow(/autoSuspendSeconds/)
    // Snowflake documents no upper bound, so a long idle window must be allowed.
    expect(
      buildAlterWarehouse({ ...context, warehouseName: 'ETL_WH', autoSuspendSeconds: 900_000 })
        .statement
    ).toBe('ALTER WAREHOUSE ETL_WH SET AUTO_SUSPEND = 900000')
    expect(() => buildAlterWarehouse({ ...context, warehouseName: 'ETL_WH' })).toThrow(
      /at least one of/
    )
  })

  it('unloads from exactly one source and orders the COPY INTO clauses', () => {
    const base = {
      ...context,
      database: 'ANALYTICS',
      schema: 'PUBLIC',
      stagePath: '@EXPORTS/daily',
    }
    expect(
      buildUnloadData({
        ...base,
        table: 'EVENTS',
        fileFormat: 'ANALYTICS.PUBLIC.CSV_FORMAT',
        header: true,
        overwrite: false,
        singleFile: true,
        maxFileSizeBytes: 16_777_216,
      }).statement
    ).toBe(
      "COPY INTO @EXPORTS/daily FROM ANALYTICS.PUBLIC.EVENTS FILE_FORMAT = (FORMAT_NAME = 'ANALYTICS.PUBLIC.CSV_FORMAT') OVERWRITE = FALSE SINGLE = TRUE MAX_FILE_SIZE = 16777216 HEADER = TRUE"
    )
    // A trailing semicolon on the source query would close the COPY statement.
    // The newline before the closing paren keeps a trailing line comment in the
    // source query from swallowing it.
    expect(buildUnloadData({ ...base, statement: 'SELECT 1 -- daily' }).statement).toBe(
      'COPY INTO @EXPORTS/daily FROM (SELECT 1 -- daily\n) OVERWRITE = FALSE'
    )
    expect(buildUnloadData({ ...base, statement: 'SELECT 1;' }).statement).toBe(
      'COPY INTO @EXPORTS/daily FROM (SELECT 1\n) OVERWRITE = FALSE'
    )
    expect(() => buildUnloadData({ ...base, table: 'EVENTS', statement: 'SELECT 1' })).toThrow(
      /exactly one of table or statement/
    )
    // Each of these ends the derived table early and supplies its own copy
    // options, including OVERWRITE = TRUE, by hiding a paren in a construct the
    // paren counter must skip. All are valid Snowflake syntax.
    const breakouts: Array<[string, string, RegExp]> = [
      [
        'bare paren',
        'SELECT 1) OVERWRITE = TRUE FILE_FORMAT = (TYPE = CSV',
        /unbalanced parentheses/,
      ],
      [
        'double-slash comment',
        'SELECT 1 // (\n) OVERWRITE = TRUE FILE_FORMAT = (TYPE = CSV // )',
        /unbalanced parentheses/,
      ],
      [
        'dollar quoting',
        'SELECT $$($$ ) OVERWRITE = TRUE FILE_FORMAT = (TYPE = CSV, RECORD_DELIMITER = $$)$$',
        /unbalanced parentheses/,
      ],
      [
        'nested block comment',
        'SELECT 1 /* /* */ ( */ ) OVERWRITE = TRUE /* /* */ ) */',
        /nested block comment/,
      ],
    ]
    for (const [name, statement, expected] of breakouts) {
      expect(() => buildUnloadData({ ...base, statement }), name).toThrow(expected)
    }

    // A paren legitimately inside a dollar-quoted string is not a breakout.
    expect(buildUnloadData({ ...base, statement: 'SELECT $$a)b$$ AS x' }).statement).toContain(
      'FROM (SELECT $$a)b$$ AS x\n)'
    )
    expect(() => buildUnloadData({ ...base, statement: 'SELECT $$unterminated' })).toThrow(
      /unterminated dollar-quoted string/
    )

    // OVERWRITE is always emitted, so an injected duplicate collides instead of
    // silently replacing staged files.
    expect(buildUnloadData({ ...base, table: 'EVENTS' }).statement).toContain('OVERWRITE = FALSE')
    expect(() => buildUnloadData({ ...base, statement: 'DROP TABLE EVENTS' })).toThrow(
      /must be a SELECT or WITH query/
    )
    // Parens and quotes inside string literals and comments are not miscounted.
    expect(
      buildUnloadData({ ...base, statement: "SELECT ')' AS a -- )\nFROM T" }).statement
    ).toContain("FROM (SELECT ')' AS a -- )\nFROM T\n)")
    expect(() => buildUnloadData(base)).toThrow(/exactly one of table or statement/)
    expect(() =>
      buildUnloadData({ ...base, table: 'EVENTS', maxFileSizeBytes: 5_368_709_121 })
    ).toThrow(/maxFileSizeBytes/)
  })

  it('emits history filters as literals so none can be silently dropped', () => {
    expect(
      buildListQueryHistory({
        ...context,
        limit: 50,
        userName: 'analyst_svc',
        startTime: historyStart,
        endTime: historyEnd,
        errorOnly: true,
      })
    ).toEqual({
      statement: `SELECT * FROM TABLE(SNOWFLAKE.INFORMATION_SCHEMA.QUERY_HISTORY_BY_USER(RESULT_LIMIT => 50, USER_NAME => 'ANALYST_SVC', END_TIME_RANGE_START => TO_TIMESTAMP_LTZ('${historyStart}'), END_TIME_RANGE_END => TO_TIMESTAMP_LTZ('${historyEnd}'))) WHERE UPPER(EXECUTION_STATUS) IN ('FAILED_WITH_ERROR', 'FAILED_WITH_INCIDENT') ORDER BY END_TIME DESC`,
    })
    expect(buildListQueryHistory({ ...context, warehouseName: 'ETL_WH' }).statement).toContain(
      "SNOWFLAKE.INFORMATION_SCHEMA.QUERY_HISTORY_BY_WAREHOUSE(RESULT_LIMIT => 1000, WAREHOUSE_NAME => 'ETL_WH')"
    )
    expect(buildListQueryHistory({ ...context }).statement).toContain(
      'SNOWFLAKE.INFORMATION_SCHEMA.QUERY_HISTORY(RESULT_LIMIT => 1000)'
    )
    expect(() => buildListQueryHistory({ ...context, userName: 'A', warehouseName: 'B' })).toThrow(
      /by user or by warehouse/
    )
    expect(() => buildListQueryHistory({ ...context, startTime: 'yesterday' })).toThrow(
      /ISO-8601 timestamp within the last 7 days/
    )
    // The retention window is enforced, not just advertised in the message.
    expect(() => buildListQueryHistory({ ...context, startTime: '2020-01-01T00:00:00Z' })).toThrow(
      /within the last 7 days/
    )
  })

  it('requires a start time for copy history and bounds it outside the table function', () => {
    expect(
      buildListCopyHistory({
        ...context,
        database: 'ANALYTICS',
        schema: 'PUBLIC',
        table: 'EVENTS',
        startTime: copyStart,
        limit: 20,
      }).statement
    ).toBe(
      `SELECT * FROM TABLE(ANALYTICS.INFORMATION_SCHEMA.COPY_HISTORY(TABLE_NAME => 'ANALYTICS.PUBLIC.EVENTS', START_TIME => TO_TIMESTAMP_LTZ('${copyStart}'))) ORDER BY LAST_LOAD_TIME DESC LIMIT 20`
    )
    expect(() =>
      buildListCopyHistory({
        ...context,
        database: 'ANALYTICS',
        schema: 'PUBLIC',
        table: 'EVENTS',
        startTime: 'last tuesday',
      })
    ).toThrow(/ISO-8601 timestamp within the last 14 days/)
    expect(() =>
      buildListCopyHistory({
        ...context,
        database: 'ANALYTICS',
        schema: 'PUBLIC',
        table: 'EVENTS',
        startTime: '2020-01-01T00:00:00Z',
      })
    ).toThrow(/within the last 14 days/)
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
      startTime: historyStart,
      errorOnly: true,
      limit: 50,
    })
    expect(history.statement).toContain('RESULT_LIMIT => 50, ERROR_ONLY => TRUE')
    expect(history.bindings).toEqual({ '1': { type: 'TEXT', value: 'DAILY_LOAD' } })
    const run = buildGetTaskRun({
      ...context,
      queryId,
      taskName: 'DAILY_LOAD',
      startTime: historyStart,
    })
    expect(run.statement).toContain('TASK_NAME => ?')
    expect(run.statement).toContain('WHERE QUERY_ID = ?')
    expect(run.bindings).toEqual({
      '1': { type: 'TEXT', value: 'DAILY_LOAD' },
      '2': { type: 'TEXT', value: queryId },
    })
    expect(() =>
      buildListTaskRuns({ ...context, taskName: 'ANALYTICS.PUBLIC.DAILY_LOAD' })
    ).toThrow('unqualified task name')

    /**
     * TASK_HISTORY silently drops a bind in its time-range arguments, so the window has to
     * reach Snowflake as a literal or the filter becomes a no-op with no error.
     */
    const window = buildListTaskRuns({
      ...context,
      startTime: historyStart,
      endTime: historyEnd,
    })
    expect(window.statement).toContain(
      `SCHEDULED_TIME_RANGE_START => TO_TIMESTAMP_LTZ('${historyStart}')`
    )
    expect(window.statement).toContain(
      `SCHEDULED_TIME_RANGE_END => TO_TIMESTAMP_LTZ('${historyEnd}')`
    )
    expect(window.statement).not.toContain('TO_TIMESTAMP_LTZ(?)')
    expect(window.bindings).toEqual({})
    expect(() => buildListTaskRuns({ ...context, startTime: 'not-a-timestamp' })).toThrow(
      'startTime must be an ISO-8601 timestamp'
    )
    expect(() => buildGetTaskRun({ ...context, queryId, endTime: 'nope' })).toThrow(
      'endTime must be an ISO-8601 timestamp'
    )
    expect(() =>
      buildGetTaskRun({ ...context, queryId, taskName: 'ANALYTICS.PUBLIC.DAILY_LOAD' })
    ).toThrow('unqualified task name')
    expect(buildListTaskRuns({ ...context, taskName: 'daily_load' }).bindings).toMatchObject({
      '1': { type: 'TEXT', value: 'DAILY_LOAD' },
    })
    expect(buildListTaskRuns({ ...context, taskName: '"my.task"' }).bindings).toMatchObject({
      '1': { type: 'TEXT', value: 'my.task' },
    })
    expect(buildGetTaskRun({ ...context, queryId, taskName: '"my.task"' }).bindings).toMatchObject({
      '1': { type: 'TEXT', value: 'my.task' },
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
    expect(schema.statement).toContain("t.TABLE_TYPE NOT IN ('VIEW', 'MATERIALIZED VIEW')")
    expect(schema.statement).not.toContain("t.TABLE_TYPE = 'BASE TABLE'")
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
