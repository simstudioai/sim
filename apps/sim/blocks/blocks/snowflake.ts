import { SnowflakeIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { parseOptionalJsonInput, parseOptionalNumberInput } from '@/blocks/utils'
import type { SnowflakeStatementResponse } from '@/tools/snowflake/types'
import { SNOWFLAKE_WAREHOUSE_SIZES } from '@/tools/snowflake/types'

const sqlSubmissionOperations = [
  'execute_sql',
  'insert_rows',
  'update_rows',
  'upsert_rows',
  'delete_rows',
  'load_data',
  'unload_data',
  'list_databases',
  'list_schemas',
  'list_tables',
  'list_warehouses',
  'get_warehouse',
  'resume_warehouse',
  'suspend_warehouse',
  'alter_warehouse',
  'list_tasks',
  'get_task',
  'run_task',
  'resume_task',
  'suspend_task',
  'list_task_runs',
  'get_task_run',
  'cancel_task_run',
  'get_task_run_output',
  'list_query_history',
  'list_copy_history',
  'introspect_schema',
  'call_procedure',
] as const

const computeOperations = [
  'execute_sql',
  'insert_rows',
  'update_rows',
  'upsert_rows',
  'delete_rows',
  'load_data',
  'unload_data',
  'list_task_runs',
  'get_task_run',
  'cancel_task_run',
  'get_task_run_output',
  'list_query_history',
  'list_copy_history',
  'introspect_schema',
  'call_procedure',
] as const

const maxRowsOperations = [
  'execute_sql',
  'load_data',
  'unload_data',
  'list_warehouses',
  'get_task_run_output',
  'introspect_schema',
  'call_procedure',
] as const

const dataOperations = [
  'insert_rows',
  'update_rows',
  'upsert_rows',
  'delete_rows',
  'load_data',
] as const
const taskDefinitionOperations = ['list_tasks', 'get_task', 'run_task'] as const

/** Operations that name a single task inside a database and schema. */
const taskNameOperations = [
  'get_task',
  'run_task',
  'resume_task',
  'suspend_task',
  'list_task_runs',
  'get_task_run',
] as const
const taskNameRequiredOperations = ['get_task', 'run_task', 'resume_task', 'suspend_task'] as const

/** Operations that act on, or filter by, a named warehouse. */
const warehouseNameOperations = [
  'get_warehouse',
  'resume_warehouse',
  'suspend_warehouse',
  'alter_warehouse',
  'list_query_history',
] as const
const warehouseNameRequiredOperations = [
  'get_warehouse',
  'resume_warehouse',
  'suspend_warehouse',
  'alter_warehouse',
] as const

/** Operations scoped to a database, and the subset that cannot run without one. */
const databaseOperations = [
  'execute_sql',
  ...dataOperations,
  'unload_data',
  'list_schemas',
  'list_tables',
  ...taskDefinitionOperations,
  'resume_task',
  'suspend_task',
  'list_copy_history',
  'introspect_schema',
  'call_procedure',
] as const
const databaseRequiredOperations = [
  ...dataOperations,
  'unload_data',
  'list_schemas',
  'list_tables',
  ...taskDefinitionOperations,
  'resume_task',
  'suspend_task',
  'list_copy_history',
  'introspect_schema',
  'call_procedure',
] as const

/** Operations scoped to a schema, and the subset that cannot run without one. */
const schemaOperations = [
  'execute_sql',
  ...dataOperations,
  'unload_data',
  'list_tables',
  ...taskDefinitionOperations,
  'resume_task',
  'suspend_task',
  'list_copy_history',
  'introspect_schema',
  'call_procedure',
] as const
const schemaRequiredOperations = [
  ...dataOperations,
  'unload_data',
  'list_tables',
  ...taskDefinitionOperations,
  'resume_task',
  'suspend_task',
  'list_copy_history',
  'call_procedure',
] as const

/** Operations that name a table, and the subset that cannot run without one. */
const tableOperations = [
  ...dataOperations,
  'unload_data',
  'list_copy_history',
  'introspect_schema',
] as const
const tableRequiredOperations = [...dataOperations, 'unload_data', 'list_copy_history'] as const

/** Operations that bound their result with a `limit` parameter. */
const limitOperations = [
  'list_databases',
  'list_schemas',
  'list_tables',
  'list_tasks',
  'list_task_runs',
  'list_query_history',
  'list_copy_history',
] as const

/** Operations that filter object names with a SQL LIKE pattern. */
const nameLikeOperations = [
  'list_databases',
  'list_schemas',
  'list_tables',
  'list_warehouses',
  'list_tasks',
] as const

/** Operations that take an ISO-8601 time window. */
const timeRangeOperations = [
  'list_task_runs',
  'get_task_run',
  'list_query_history',
  'list_copy_history',
] as const

const sqlSubmissionOperationSet: ReadonlySet<string> = new Set(sqlSubmissionOperations)
const maxRowsOperationSet: ReadonlySet<string> = new Set(maxRowsOperations)
const limitOperationSet: ReadonlySet<string> = new Set(limitOperations)

/**
 * Normalizes an optional switch to a real boolean or `undefined`.
 *
 * With advanced mode on, the serializer evaluates each advanced sub-block's
 * condition and emits an untouched switch as `null`. Builders test these with
 * `!== undefined`, so that `null` would otherwise emit a clause the user never
 * asked for — `AUTO_RESUME = FALSE`, which permanently disables auto-resume on
 * the warehouse, being the damaging one.
 *
 * The string forms are accepted because a direct tool call delivers booleans
 * that way, matching the other boolean readers on this block.
 */
function optionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  return undefined
}

function resolveCopyOnError(value: unknown, threshold: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (value !== 'SKIP_FILE_NUMBER' && value !== 'SKIP_FILE_PERCENT') return String(value)

  const number = parseOptionalNumberInput(threshold, 'Skip file threshold')
  if (number === undefined || number <= 0) {
    throw new Error('Skip file threshold must be greater than zero')
  }
  if (value === 'SKIP_FILE_PERCENT' && (number > 100 || !Number.isInteger(number))) {
    throw new Error('Skip file percentage must be a whole number between 1 and 100')
  }
  if (value === 'SKIP_FILE_NUMBER' && !Number.isInteger(number)) {
    throw new Error('Skip file error count must be a positive integer')
  }
  return `SKIP_FILE_${number}${value === 'SKIP_FILE_PERCENT' ? '%' : ''}`
}

export const SnowflakeBlock: BlockConfig<SnowflakeStatementResponse> = {
  type: 'snowflake',
  name: 'Snowflake',
  description: 'Query data and manage warehouses and tasks in Snowflake',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Connect with a Snowflake programmatic access token to execute SQL, synchronize structured rows, load and unload staged data, browse databases and schemas, size and control warehouses, run and schedule tasks, review query and load history, inspect schemas, and call stored procedures.',
  docsLink: 'https://docs.sim.ai/integrations/snowflake',
  category: 'tools',
  integrationType: IntegrationType.Databases,
  bgColor: '#FFFFFF',
  icon: SnowflakeIcon,
  canvasPresentation: {
    defaultTitle: 'Snowflake',
    sentences: {
      byOperation: {
        execute_sql: [{ text: 'Run', field: 'statement', core: true }],
        get_statement: [
          { text: 'Fetch the result of statement', field: 'statementHandle', core: true },
        ],
        cancel_statement: [{ text: 'Cancel statement', field: 'statementHandle', core: true }],
        insert_rows: [
          { text: 'Insert', field: 'rows', core: true },
          { text: 'into', field: ['tableSelector', 'tableName'], core: true },
        ],
        update_rows: [
          { text: 'Update', field: 'rows', core: true },
          { text: 'in', field: ['tableSelector', 'tableName'], core: true },
          { text: ', matching', field: 'matchColumns' },
        ],
        upsert_rows: [
          { text: 'Upsert', field: 'rows', core: true },
          { text: 'into', field: ['tableSelector', 'tableName'], core: true },
          { text: ', matching', field: 'matchColumns' },
        ],
        delete_rows: [
          { text: 'Delete rows from', field: ['tableSelector', 'tableName'], core: true },
          { text: ', matching', field: 'filters' },
        ],
        load_data: [
          { text: 'Load', field: 'stagePath', core: true },
          { text: 'into', field: ['tableSelector', 'tableName'], core: true },
        ],
        unload_data: [
          { text: 'Unload', field: ['tableSelector', 'tableName'], core: true },
          { text: 'to', field: 'stagePath', core: true },
        ],
        list_databases: ['List databases', { text: ', named like', field: 'nameLike' }],
        list_schemas: [
          { text: 'List schemas in', field: ['databaseSelector', 'databaseName'], core: true },
          { text: ', named like', field: 'nameLike' },
        ],
        list_tables: [
          { text: 'List tables in', field: ['schemaSelector', 'schemaName'], core: true },
          { text: ', named like', field: 'nameLike' },
        ],
        list_warehouses: ['List warehouses', { text: ', named like', field: 'nameLike' }],
        get_warehouse: [
          {
            text: 'Read warehouse',
            field: ['warehouseNameSelector', 'warehouseNameManual'],
            core: true,
          },
        ],
        resume_warehouse: [
          {
            text: 'Resume warehouse',
            field: ['warehouseNameSelector', 'warehouseNameManual'],
            core: true,
          },
        ],
        suspend_warehouse: [
          {
            text: 'Suspend warehouse',
            field: ['warehouseNameSelector', 'warehouseNameManual'],
            core: true,
          },
        ],
        alter_warehouse: [
          {
            text: 'Resize warehouse',
            field: ['warehouseNameSelector', 'warehouseNameManual'],
            core: true,
          },
          { text: 'to', field: 'warehouseSize' },
        ],
        list_tasks: [
          { text: 'List tasks in', field: ['schemaSelector', 'schemaName'], core: true },
          { text: ', named like', field: 'nameLike' },
        ],
        get_task: [{ text: 'Read task', field: 'taskName', core: true }],
        run_task: [{ text: 'Run task', field: 'taskName', core: true }],
        resume_task: [{ text: 'Resume task', field: 'taskName', core: true }],
        suspend_task: [{ text: 'Suspend task', field: 'taskName', core: true }],
        /* `taskName` filters these two rather than keying them, so it cannot
           anchor the clause — blank means every task, not a missing value. */
        list_task_runs: [
          'List task runs',
          { text: 'of task', field: 'taskName' },
          { text: ', scheduled after', field: 'startTime' },
        ],
        get_task_run: [
          { text: 'Read task run', field: 'queryId', core: true },
          { text: 'of task', field: 'taskName' },
        ],
        cancel_task_run: [{ text: 'Cancel task run', field: 'queryId', core: true }],
        get_task_run_output: [
          { text: 'Read the output of task run', field: 'queryId', core: true },
        ],
        list_query_history: [
          'List query history',
          { text: 'on warehouse', field: ['warehouseNameSelector', 'warehouseNameManual'] },
          { text: ', since', field: 'startTime' },
        ],
        list_copy_history: [
          { text: 'List copy history for', field: ['tableSelector', 'tableName'], core: true },
          { text: ', since', field: 'startTime' },
        ],
        /* The table is an optional filter here — with it blank the operation
           describes the whole schema, so the schema is what the card anchors on. */
        introspect_schema: [
          { text: 'Describe the tables in', field: ['schemaSelector', 'schemaName'], core: true },
          { text: ', named', field: ['tableSelector', 'tableName'] },
        ],
        call_procedure: [
          { text: 'Call', field: ['procedureSelector', 'procedureNameManual'], core: true },
          { text: ', with', field: 'procedureArguments' },
        ],
      },
    },
  },
  subBlocks: [
    {
      id: 'credential',
      title: 'Snowflake Account',
      type: 'oauth-input',
      serviceId: 'snowflake',
      credentialKind: 'service-account',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      placeholder: 'Select Snowflake credential',
      required: true,
    },
    {
      id: 'manualCredential',
      title: 'Snowflake Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      required: true,
    },
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Execute SQL', id: 'execute_sql' },
        { label: 'Get Statement', id: 'get_statement' },
        { label: 'Cancel Statement', id: 'cancel_statement' },
        { label: 'Insert Rows', id: 'insert_rows' },
        { label: 'Update Rows', id: 'update_rows' },
        { label: 'Upsert Rows', id: 'upsert_rows' },
        { label: 'Delete Rows', id: 'delete_rows' },
        { label: 'Load Data', id: 'load_data' },
        { label: 'Unload Data', id: 'unload_data' },
        { label: 'List Databases', id: 'list_databases' },
        { label: 'List Schemas', id: 'list_schemas' },
        { label: 'List Tables', id: 'list_tables' },
        { label: 'List Warehouses', id: 'list_warehouses' },
        { label: 'Get Warehouse', id: 'get_warehouse' },
        { label: 'Resume Warehouse', id: 'resume_warehouse' },
        { label: 'Suspend Warehouse', id: 'suspend_warehouse' },
        { label: 'Alter Warehouse', id: 'alter_warehouse' },
        { label: 'List Tasks', id: 'list_tasks' },
        { label: 'Get Task', id: 'get_task' },
        { label: 'Run Task', id: 'run_task' },
        { label: 'Resume Task', id: 'resume_task' },
        { label: 'Suspend Task', id: 'suspend_task' },
        { label: 'List Task Runs', id: 'list_task_runs' },
        { label: 'Get Task Run', id: 'get_task_run' },
        { label: 'Cancel Task Query', id: 'cancel_task_run' },
        { label: 'Get Task Run Output', id: 'get_task_run_output' },
        { label: 'List Query History', id: 'list_query_history' },
        { label: 'List Copy History', id: 'list_copy_history' },
        { label: 'Introspect Schema', id: 'introspect_schema' },
        { label: 'Call Procedure', id: 'call_procedure' },
      ],
      value: () => 'execute_sql',
    },
    {
      id: 'statement',
      title: 'SQL Statement',
      type: 'code',
      placeholder: 'SELECT * FROM ANALYTICS.PUBLIC.EVENTS LIMIT 100',
      condition: { field: 'operation', value: 'execute_sql' },
      required: { field: 'operation', value: 'execute_sql' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate one Snowflake SQL statement for the described request. Use positional ? placeholders for any values that will be bound. Return ONLY the SQL statement - no explanations, no extra text.',
        placeholder: 'Describe the query to run...',
        generationType: 'sql-query',
      },
    },
    {
      id: 'bindings',
      title: 'Bindings',
      type: 'code',
      language: 'json',
      placeholder: '{"1":{"type":"TEXT","value":"active"}}',
      condition: { field: 'operation', value: 'execute_sql' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON object keyed by 1-based binding position. Each value must contain a Snowflake binding type and a string value, for example {"1":{"type":"TEXT","value":"active"}}. Return ONLY the JSON object - no explanations, no extra text.',
        placeholder: 'Describe the values and Snowflake types to bind...',
        generationType: 'json-object',
      },
    },
    {
      id: 'async',
      title: 'Run Asynchronously',
      type: 'switch',
      condition: { field: 'operation', value: 'execute_sql' },
      mode: 'advanced',
    },
    {
      id: 'statementHandle',
      title: 'Statement Handle',
      type: 'short-input',
      placeholder: 'Enter the Snowflake statement handle',
      condition: { field: 'operation', value: ['get_statement', 'cancel_statement'] },
      required: { field: 'operation', value: ['get_statement', 'cancel_statement'] },
    },
    {
      id: 'partition',
      title: 'Result Partition',
      type: 'short-input',
      placeholder: '0',
      condition: { field: 'operation', value: 'get_statement' },
      mode: 'advanced',
    },
    {
      id: 'partitionCount',
      title: 'Total Partitions',
      type: 'short-input',
      placeholder: 'partitionCount from the first partition',
      condition: { field: 'operation', value: 'get_statement' },
      mode: 'advanced',
    },
    {
      id: 'databaseSelector',
      title: 'Database',
      type: 'project-selector',
      canonicalParamId: 'database',
      serviceId: 'snowflake',
      selectorKey: 'snowflake.databases',
      placeholder: 'Select database',
      dependsOn: ['credential'],
      mode: 'basic',
      condition: { field: 'operation', value: [...databaseOperations] },
      required: { field: 'operation', value: [...databaseRequiredOperations] },
    },
    {
      id: 'databaseName',
      title: 'Database',
      type: 'short-input',
      canonicalParamId: 'database',
      placeholder: 'ANALYTICS',
      mode: 'advanced',
      condition: { field: 'operation', value: [...databaseOperations] },
      required: { field: 'operation', value: [...databaseRequiredOperations] },
    },
    {
      id: 'schemaSelector',
      title: 'Schema',
      type: 'project-selector',
      canonicalParamId: 'schema',
      serviceId: 'snowflake',
      selectorKey: 'snowflake.schemas',
      placeholder: 'Select schema',
      dependsOn: ['credential', 'databaseSelector'],
      mode: 'basic',
      condition: { field: 'operation', value: [...schemaOperations] },
      required: { field: 'operation', value: [...schemaRequiredOperations] },
    },
    {
      id: 'schemaName',
      title: 'Schema',
      type: 'short-input',
      canonicalParamId: 'schema',
      placeholder: 'PUBLIC',
      mode: 'advanced',
      condition: { field: 'operation', value: [...schemaOperations] },
      required: { field: 'operation', value: [...schemaRequiredOperations] },
    },
    {
      id: 'tableSelector',
      title: 'Table',
      type: 'project-selector',
      canonicalParamId: 'table',
      serviceId: 'snowflake',
      selectorKey: 'snowflake.tables',
      placeholder: 'Select table',
      dependsOn: ['credential', 'databaseSelector', 'schemaSelector'],
      mode: 'basic',
      condition: { field: 'operation', value: [...tableOperations] },
      required: { field: 'operation', value: [...tableRequiredOperations] },
    },
    {
      id: 'tableName',
      title: 'Table',
      type: 'short-input',
      canonicalParamId: 'table',
      placeholder: 'EVENTS',
      mode: 'advanced',
      condition: { field: 'operation', value: [...tableOperations] },
      required: { field: 'operation', value: [...tableRequiredOperations] },
    },
    {
      id: 'rows',
      title: 'Rows',
      type: 'code',
      language: 'json',
      placeholder: '[{"id":1,"status":"active"}]',
      condition: { field: 'operation', value: ['insert_rows', 'update_rows', 'upsert_rows'] },
      required: { field: 'operation', value: ['insert_rows', 'update_rows', 'upsert_rows'] },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a non-empty JSON array of flat row objects. Every row must have the same keys. Use Load Data instead for bulk ingestion from staged files. Return ONLY the JSON array - no explanations, no extra text.',
        placeholder: 'Describe the records to write...',
        generationType: 'json-array',
      },
    },
    {
      id: 'matchColumns',
      title: 'Match Columns',
      type: 'code',
      language: 'json',
      placeholder: '["id"]',
      condition: { field: 'operation', value: ['update_rows', 'upsert_rows'] },
      required: { field: 'operation', value: ['update_rows', 'upsert_rows'] },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON array containing the row column names that uniquely match target records, for example ["tenant_id","id"]. Return ONLY the JSON array - no explanations, no extra text.',
        placeholder: 'Describe the columns that identify a row...',
        generationType: 'json-array',
      },
    },
    {
      id: 'filters',
      title: 'Match Filters',
      type: 'code',
      language: 'json',
      placeholder: '{"status":"expired","tenant_id":42,"archived_at":null}',
      condition: { field: 'operation', value: 'delete_rows' },
      required: { field: 'operation', value: 'delete_rows' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a non-empty JSON object of column filters. All filters are combined with AND. A null value matches rows where that column IS NULL; every other value is matched for equality. Return ONLY the JSON object - no explanations, no extra text.',
        placeholder: 'Describe the exact rows to delete...',
        generationType: 'json-object',
      },
    },
    {
      id: 'stagePath',
      title: 'Stage Path',
      type: 'short-input',
      placeholder: '@RAW_STAGE/2026/08',
      condition: { field: 'operation', value: ['load_data', 'unload_data'] },
      required: { field: 'operation', value: ['load_data', 'unload_data'] },
    },
    {
      id: 'fileFormatSelector',
      title: 'Named File Format',
      type: 'project-selector',
      canonicalParamId: 'fileFormat',
      serviceId: 'snowflake',
      selectorKey: 'snowflake.fileFormats',
      placeholder: 'Select file format',
      dependsOn: ['credential', 'databaseSelector', 'schemaSelector'],
      mode: 'basic',
      condition: { field: 'operation', value: ['load_data', 'unload_data'] },
    },
    {
      id: 'fileFormatName',
      title: 'Named File Format',
      type: 'short-input',
      canonicalParamId: 'fileFormat',
      placeholder: 'ANALYTICS.PUBLIC.CSV_FORMAT',
      condition: { field: 'operation', value: ['load_data', 'unload_data'] },
      mode: 'advanced',
    },
    {
      id: 'pattern',
      title: 'File Pattern',
      type: 'short-input',
      placeholder: '.*[.]csv',
      condition: { field: 'operation', value: 'load_data' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a single regular expression that COPY INTO uses to select staged file paths, for example .*[.]csv or .*/2026/08/.*[.]json[.]gz. Use only regular expression syntax and no quotes. Return ONLY the pattern - no explanations, no extra text.',
        placeholder: 'Describe which staged files to load...',
      },
    },
    {
      id: 'onError',
      title: 'On Error',
      type: 'dropdown',
      options: [
        { label: 'Abort Statement', id: 'ABORT_STATEMENT' },
        { label: 'Continue', id: 'CONTINUE' },
        { label: 'Skip File', id: 'SKIP_FILE' },
        { label: 'Skip File After Error Count', id: 'SKIP_FILE_NUMBER' },
        { label: 'Skip File After Error Percentage', id: 'SKIP_FILE_PERCENT' },
      ],
      value: () => 'ABORT_STATEMENT',
      condition: { field: 'operation', value: 'load_data' },
      mode: 'advanced',
    },
    {
      id: 'onErrorThreshold',
      title: 'Skip File Threshold',
      type: 'short-input',
      placeholder: '10',
      condition: {
        field: 'operation',
        value: 'load_data',
        and: { field: 'onError', value: ['SKIP_FILE_NUMBER', 'SKIP_FILE_PERCENT'] },
      },
      required: {
        field: 'operation',
        value: 'load_data',
        and: { field: 'onError', value: ['SKIP_FILE_NUMBER', 'SKIP_FILE_PERCENT'] },
      },
    },
    {
      id: 'purge',
      title: 'Purge Loaded Files',
      type: 'switch',
      condition: { field: 'operation', value: 'load_data' },
      mode: 'advanced',
    },
    {
      id: 'force',
      title: 'Force Reload',
      type: 'switch',
      condition: { field: 'operation', value: 'load_data' },
      mode: 'advanced',
    },
    {
      id: 'matchByColumnName',
      title: 'Match by Column Name',
      type: 'dropdown',
      options: [
        { label: 'None', id: 'NONE' },
        { label: 'Case Sensitive', id: 'CASE_SENSITIVE' },
        { label: 'Case Insensitive', id: 'CASE_INSENSITIVE' },
      ],
      value: () => 'NONE',
      condition: { field: 'operation', value: 'load_data' },
      mode: 'advanced',
    },
    {
      id: 'warehouseNameSelector',
      title: 'Warehouse Name',
      type: 'project-selector',
      canonicalParamId: 'warehouseName',
      serviceId: 'snowflake',
      selectorKey: 'snowflake.warehouses',
      placeholder: 'Select warehouse',
      dependsOn: ['credential'],
      mode: 'basic',
      condition: { field: 'operation', value: [...warehouseNameOperations] },
      required: { field: 'operation', value: [...warehouseNameRequiredOperations] },
    },
    {
      id: 'warehouseNameManual',
      title: 'Warehouse Name',
      type: 'short-input',
      canonicalParamId: 'warehouseName',
      placeholder: 'COMPUTE_WH',
      mode: 'advanced',
      condition: { field: 'operation', value: [...warehouseNameOperations] },
      required: { field: 'operation', value: [...warehouseNameRequiredOperations] },
    },
    {
      id: 'nameLike',
      title: 'Name Pattern',
      type: 'short-input',
      placeholder: 'ETL%',
      condition: { field: 'operation', value: [...nameLikeOperations] },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a single SQL LIKE pattern that matches Snowflake object names, using % for any sequence and _ for one character, for example ETL%. Use only the pattern and no quotes. Return ONLY the pattern - no explanations, no extra text.',
        placeholder: 'Describe which object names to match...',
      },
    },
    {
      id: 'taskName',
      title: 'Task Name',
      type: 'short-input',
      placeholder: 'DAILY_LOAD (name only, not DB.SCHEMA.TASK)',
      condition: { field: 'operation', value: [...taskNameOperations] },
      required: { field: 'operation', value: [...taskNameRequiredOperations] },
    },
    {
      id: 'retryLast',
      title: 'Retry Last Failed Run',
      type: 'switch',
      condition: { field: 'operation', value: 'run_task' },
      mode: 'advanced',
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '100',
      condition: { field: 'operation', value: [...limitOperations] },
      mode: 'advanced',
    },
    {
      id: 'startTime',
      title: 'Time From',
      type: 'short-input',
      placeholder: '2026-08-01T00:00:00Z',
      condition: { field: 'operation', value: [...timeRangeOperations] },
      required: { field: 'operation', value: 'list_copy_history' },
      wandConfig: {
        enabled: true,
        prompt:
          'Convert the requested start date and time to an ISO 8601 timestamp. Task and query history reach back seven days; copy history reaches back fourteen. Return ONLY the timestamp - no explanations, no extra text.',
        placeholder: 'Describe the beginning of the history window...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'endTime',
      title: 'Time To',
      type: 'short-input',
      placeholder: '2026-08-07T00:00:00Z',
      condition: { field: 'operation', value: [...timeRangeOperations] },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Convert the requested end date and time to an ISO 8601 timestamp. Return ONLY the timestamp - no explanations, no extra text.',
        placeholder: 'Describe the end of the history window...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'errorOnly',
      title: 'Failures Only',
      type: 'switch',
      condition: { field: 'operation', value: ['list_task_runs', 'list_query_history'] },
      mode: 'advanced',
    },
    {
      id: 'queryId',
      title: 'Task Run Query ID',
      type: 'short-input',
      placeholder: 'Snowflake query UUID',
      condition: {
        field: 'operation',
        value: ['get_task_run', 'cancel_task_run', 'get_task_run_output'],
      },
      required: {
        field: 'operation',
        value: ['get_task_run', 'cancel_task_run', 'get_task_run_output'],
      },
    },
    {
      id: 'warehouseSize',
      title: 'Warehouse Size',
      type: 'dropdown',
      options: [
        { label: 'Keep current size', id: '' },
        ...SNOWFLAKE_WAREHOUSE_SIZES.map((size) => ({ label: size, id: size })),
      ],
      value: () => '',
      condition: { field: 'operation', value: 'alter_warehouse' },
    },
    {
      id: 'autoSuspendSeconds',
      title: 'Auto-Suspend (seconds)',
      type: 'short-input',
      placeholder: '600',
      condition: { field: 'operation', value: 'alter_warehouse' },
      mode: 'advanced',
    },
    {
      id: 'autoResume',
      title: 'Auto-Resume',
      type: 'switch',
      condition: { field: 'operation', value: 'alter_warehouse' },
      mode: 'advanced',
    },
    {
      id: 'header',
      title: 'Write Column Headings',
      type: 'switch',
      condition: { field: 'operation', value: 'unload_data' },
      mode: 'advanced',
    },
    {
      id: 'overwrite',
      title: 'Overwrite Existing Files',
      type: 'switch',
      condition: { field: 'operation', value: 'unload_data' },
      mode: 'advanced',
    },
    {
      id: 'singleFile',
      title: 'Write a Single File',
      type: 'switch',
      condition: { field: 'operation', value: 'unload_data' },
      mode: 'advanced',
    },
    {
      id: 'maxFileSizeBytes',
      title: 'Maximum File Size (bytes)',
      type: 'short-input',
      placeholder: '16000000',
      condition: { field: 'operation', value: 'unload_data' },
      mode: 'advanced',
    },
    {
      id: 'userName',
      title: 'User Name',
      type: 'short-input',
      placeholder: 'ANALYST_SVC',
      condition: { field: 'operation', value: 'list_query_history' },
      mode: 'advanced',
    },
    {
      id: 'includeViews',
      title: 'Include Views',
      type: 'switch',
      condition: { field: 'operation', value: 'introspect_schema' },
      mode: 'advanced',
    },
    {
      id: 'procedureSelector',
      title: 'Procedure Name',
      type: 'project-selector',
      canonicalParamId: 'procedureName',
      serviceId: 'snowflake',
      selectorKey: 'snowflake.procedures',
      placeholder: 'Select procedure',
      dependsOn: ['credential', 'databaseSelector', 'schemaSelector'],
      mode: 'basic',
      condition: { field: 'operation', value: 'call_procedure' },
      required: { field: 'operation', value: 'call_procedure' },
    },
    {
      id: 'procedureNameManual',
      title: 'Procedure Name',
      type: 'short-input',
      canonicalParamId: 'procedureName',
      placeholder: 'REFRESH_MODEL',
      mode: 'advanced',
      condition: { field: 'operation', value: 'call_procedure' },
      required: { field: 'operation', value: 'call_procedure' },
    },
    {
      id: 'procedureArguments',
      title: 'Procedure Arguments',
      type: 'code',
      language: 'json',
      placeholder: '[{"type":"TEXT","value":"daily"}]',
      condition: { field: 'operation', value: 'call_procedure' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an ordered JSON array of Snowflake procedure bindings. Each item must contain a supported Snowflake binding type and a string value, for example {"type":"TEXT","value":"daily"}. Return ONLY the JSON array - no explanations, no extra text.',
        placeholder: 'Describe the procedure arguments in order...',
        generationType: 'json-array',
      },
    },
    {
      id: 'warehouseSelector',
      title: 'Execution Warehouse',
      type: 'project-selector',
      canonicalParamId: 'warehouse',
      serviceId: 'snowflake',
      selectorKey: 'snowflake.warehouses',
      placeholder: 'Select warehouse',
      dependsOn: ['credential'],
      mode: 'basic',
      condition: { field: 'operation', value: [...computeOperations] },
    },
    {
      id: 'warehouseManual',
      title: 'Execution Warehouse',
      type: 'short-input',
      canonicalParamId: 'warehouse',
      placeholder: 'COMPUTE_WH',
      condition: { field: 'operation', value: [...computeOperations] },
      mode: 'advanced',
    },
    {
      id: 'roleSelector',
      title: 'Execution Role',
      type: 'project-selector',
      canonicalParamId: 'role',
      serviceId: 'snowflake',
      selectorKey: 'snowflake.roles',
      placeholder: 'Select role',
      dependsOn: ['credential'],
      mode: 'basic',
      condition: { field: 'operation', value: [...sqlSubmissionOperations] },
    },
    {
      id: 'roleManual',
      title: 'Execution Role',
      type: 'short-input',
      canonicalParamId: 'role',
      placeholder: 'ANALYST',
      condition: { field: 'operation', value: [...sqlSubmissionOperations] },
      mode: 'advanced',
    },
    {
      id: 'statementTimeoutSeconds',
      title: 'Timeout (seconds)',
      type: 'short-input',
      placeholder: '60',
      condition: { field: 'operation', value: [...sqlSubmissionOperations] },
      mode: 'advanced',
    },
    {
      id: 'maxRows',
      title: 'Maximum Rows',
      type: 'short-input',
      placeholder: '1000',
      condition: {
        field: 'operation',
        value: [...maxRowsOperations],
      },
      mode: 'advanced',
    },
  ],
  tools: {
    access: [
      'snowflake_execute_sql',
      'snowflake_get_statement',
      'snowflake_cancel_statement',
      'snowflake_insert_rows',
      'snowflake_update_rows',
      'snowflake_upsert_rows',
      'snowflake_delete_rows',
      'snowflake_load_data',
      'snowflake_unload_data',
      'snowflake_list_databases',
      'snowflake_list_schemas',
      'snowflake_list_tables',
      'snowflake_list_warehouses',
      'snowflake_get_warehouse',
      'snowflake_resume_warehouse',
      'snowflake_suspend_warehouse',
      'snowflake_alter_warehouse',
      'snowflake_list_tasks',
      'snowflake_get_task',
      'snowflake_run_task',
      'snowflake_resume_task',
      'snowflake_suspend_task',
      'snowflake_list_task_runs',
      'snowflake_get_task_run',
      'snowflake_cancel_task_run',
      'snowflake_get_task_run_output',
      'snowflake_list_query_history',
      'snowflake_list_copy_history',
      'snowflake_introspect_schema',
      'snowflake_call_procedure',
    ],
    config: {
      tool: (params) => `snowflake_${params.operation}`,
      params: (params) => {
        const operation = String(params.operation)
        const result: Record<string, unknown> = {}

        if (sqlSubmissionOperationSet.has(operation)) {
          result.statementTimeoutSeconds = parseOptionalNumberInput(
            params.statementTimeoutSeconds,
            'Statement timeout'
          )
        }
        if (maxRowsOperationSet.has(operation)) {
          result.maxRows = parseOptionalNumberInput(params.maxRows, 'Maximum result rows')
        }
        if (limitOperationSet.has(operation)) {
          result.limit = parseOptionalNumberInput(params.limit, 'Limit')
        }

        switch (operation) {
          case 'execute_sql':
            result.bindings = parseOptionalJsonInput(params.bindings, 'Bindings')
            break
          case 'get_statement':
            result.partition = parseOptionalNumberInput(params.partition, 'Partition')
            result.partitionCount = parseOptionalNumberInput(
              params.partitionCount,
              'Total partitions'
            )
            break
          case 'insert_rows':
            result.rows = parseOptionalJsonInput(params.rows, 'Rows')
            break
          case 'update_rows':
          case 'upsert_rows':
            result.rows = parseOptionalJsonInput(params.rows, 'Rows')
            result.matchColumns = parseOptionalJsonInput(params.matchColumns, 'Match columns')
            break
          case 'delete_rows':
            result.filters = parseOptionalJsonInput(params.filters, 'Filters')
            break
          case 'load_data':
            result.onError = resolveCopyOnError(params.onError, params.onErrorThreshold)
            result.onErrorThreshold = undefined
            result.purge = optionalBoolean(params.purge)
            result.force = optionalBoolean(params.force)
            break
          case 'unload_data':
            result.maxFileSizeBytes = parseOptionalNumberInput(
              params.maxFileSizeBytes,
              'Maximum file size'
            )
            result.header = optionalBoolean(params.header)
            result.overwrite = optionalBoolean(params.overwrite)
            result.singleFile = optionalBoolean(params.singleFile)
            break
          case 'alter_warehouse':
            result.autoSuspendSeconds = parseOptionalNumberInput(
              params.autoSuspendSeconds,
              'Auto-suspend seconds'
            )
            result.autoResume = optionalBoolean(params.autoResume)
            break
          case 'call_procedure':
            result.procedureArguments = parseOptionalJsonInput(
              params.procedureArguments,
              'Procedure arguments'
            )
        }

        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    oauthCredential: {
      type: 'string',
      description: 'Snowflake credential (account host and programmatic access token)',
    },
    statement: { type: 'string', description: 'Single SQL statement' },
    bindings: {
      type: 'string',
      description: 'Typed SQL bindings as a JSON object keyed by 1-based positions',
    },
    async: { type: 'boolean', description: 'Run the SQL statement asynchronously' },
    statementHandle: { type: 'string', description: 'Snowflake SQL API statement handle' },
    partition: { type: 'number', description: 'Zero-based result partition' },
    partitionCount: {
      type: 'number',
      description:
        'Total result partitions, taken from the first partition. Required for accurate truncation reporting when fetching partition 1 or higher',
    },
    database: { type: 'string', description: 'Snowflake database name' },
    schema: { type: 'string', description: 'Snowflake schema name' },
    table: { type: 'string', description: 'Snowflake table name' },
    rows: {
      type: 'string',
      description:
        'Structured rows as a JSON array. For bulk loads, stage the files and use Load Data instead.',
    },
    matchColumns: {
      type: 'string',
      description:
        'Match columns as a JSON array. Match values must be non-null and unique across the submitted rows.',
    },
    filters: {
      type: 'string',
      description:
        'Column filters as a JSON object. A null value matches rows where that column IS NULL; every other value is matched for equality',
    },
    stagePath: { type: 'string', description: 'Existing Snowflake stage path' },
    fileFormat: { type: 'string', description: 'Named Snowflake file format' },
    pattern: { type: 'string', description: 'COPY file selection pattern' },
    onError: { type: 'string', description: 'COPY error handling policy' },
    onErrorThreshold: { type: 'number', description: 'COPY skip-file error threshold' },
    purge: { type: 'boolean', description: 'Purge successfully loaded staged files' },
    force: { type: 'boolean', description: 'Force staged files to load again' },
    matchByColumnName: { type: 'string', description: 'COPY column-name matching policy' },
    warehouseName: {
      type: 'string',
      description: 'Warehouse to retrieve or change, or to filter query history by',
    },
    nameLike: { type: 'string', description: 'SQL LIKE pattern for object names' },
    taskName: {
      type: 'string',
      description:
        'Snowflake task name without a database or schema qualifier, for example DAILY_LOAD',
    },
    retryLast: { type: 'boolean', description: 'Retry the last failed task graph' },
    limit: { type: 'number', description: 'Maximum list results' },
    startTime: { type: 'string', description: 'History window start as an ISO-8601 timestamp' },
    endTime: { type: 'string', description: 'History window end as an ISO-8601 timestamp' },
    errorOnly: {
      type: 'boolean',
      description: 'Only return task runs or queries that failed',
    },
    warehouseSize: { type: 'string', description: 'New warehouse size' },
    autoSuspendSeconds: {
      type: 'number',
      description: 'Warehouse idle seconds before auto-suspend; 0 disables it',
    },
    autoResume: {
      type: 'boolean',
      description: 'Whether the warehouse resumes automatically on the next statement',
    },
    header: { type: 'boolean', description: 'Write column headings into unloaded files' },
    overwrite: { type: 'boolean', description: 'Replace stage files with matching names' },
    singleFile: { type: 'boolean', description: 'Unload to one file instead of several' },
    maxFileSizeBytes: { type: 'number', description: 'Per-file byte ceiling for unloaded files' },
    userName: { type: 'string', description: 'Query history user filter' },
    queryId: {
      type: 'string',
      description: 'Task run query UUID. Cancel Task Query cancels only this single query',
    },
    includeViews: {
      type: 'boolean',
      description: 'Include views and materialized views alongside tables',
    },
    procedureName: { type: 'string', description: 'Stored procedure name' },
    procedureArguments: {
      type: 'string',
      description: 'Typed procedure bindings as an ordered JSON array of type/value objects',
    },
    warehouse: { type: 'string', description: 'Statement execution warehouse' },
    role: { type: 'string', description: 'Statement execution role' },
    statementTimeoutSeconds: { type: 'number', description: 'Statement timeout in seconds' },
    maxRows: { type: 'number', description: 'Maximum result rows (Sim safety limit: 10000)' },
  },
  outputs: {
    statementHandle: { type: 'string', description: 'Snowflake statement handle' },
    status: { type: 'string', description: 'SUCCEEDED, RUNNING, or CANCELED' },
    message: { type: 'string', description: 'Snowflake response message' },
    result: {
      type: 'json',
      description:
        'Completed result partition ({columns, rows, totalRows, currentPartition, partitionCount, nextPartition, truncated}). columns, totalRows and truncated are null when Snowflake returned a metadata-less partition response and partitionCount was not supplied',
    },
    dml: {
      type: 'json',
      description:
        'Completed DML statistics ({rowsInserted, rowsUpdated, rowsDeleted, duplicateRowsUpdated, rowsAffected})',
    },
  },
}

export const SnowflakeBlockMeta = {
  tags: ['data-warehouse', 'data-analytics', 'cloud'],
  url: 'https://www.snowflake.com',
  templates: [
    {
      icon: SnowflakeIcon,
      title: 'Snowflake asynchronous reporting',
      prompt:
        'Build a scheduled workflow that starts a long-running Snowflake report asynchronously, polls its statement handle until complete, summarizes the result, and posts the report to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['reporting', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: SnowflakeIcon,
      title: 'Snowflake incremental upsert',
      prompt:
        'Create a workflow that receives changed customer records, validates their keys, and upserts them into a Snowflake dimension table in bounded batches.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['sync', 'automation'],
    },
    {
      icon: SnowflakeIcon,
      title: 'Snowflake staged ingestion',
      prompt:
        'Build a workflow that loads newly staged CSV files into a Snowflake table with a named file format, records COPY results, and alerts on rejected files.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['data', 'monitoring'],
    },
    {
      icon: SnowflakeIcon,
      title: 'Snowflake task failure monitor',
      prompt:
        'Create a workflow that checks recent Snowflake task failures, retrieves the failed run details, summarizes the likely cause, and posts an actionable Slack alert.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['monitoring', 'devops'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: SnowflakeIcon,
      title: 'Snowflake warehouse cost control',
      prompt:
        'Build a scheduled workflow that reviews Snowflake warehouse state and suspends an approved idle warehouse after notifying the data platform channel.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'devops'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: SnowflakeIcon,
      title: 'Snowflake result export',
      prompt:
        'Build a scheduled workflow that unloads a Snowflake query result to a stage as a single CSV file with headers, then posts the file count and row total to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['data', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: SnowflakeIcon,
      title: 'Snowflake ingestion audit',
      prompt:
        'Create a workflow that reviews Snowflake copy history for a landing table, identifies files that failed to load, and opens a ticket with the first error on each one.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['monitoring', 'data'],
    },
    {
      icon: SnowflakeIcon,
      title: 'Snowflake slow-query review',
      prompt:
        'Build a weekly workflow that lists the longest-running Snowflake queries on a warehouse, summarizes the patterns behind them, and reports the top offenders with their elapsed times.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['analysis', 'monitoring'],
    },
    {
      icon: SnowflakeIcon,
      title: 'Snowflake task pause and resume',
      prompt:
        'Create a workflow that suspends a Snowflake task when its recent runs keep failing, notifies the data platform channel, and resumes it once someone confirms the fix.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: SnowflakeIcon,
      title: 'Snowflake schema-drift audit',
      prompt:
        'Create a daily workflow that introspects a Snowflake schema, compares its tables and columns with the previous snapshot, and reports breaking schema changes.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['monitoring', 'analysis'],
    },
    {
      icon: SnowflakeIcon,
      title: 'Snowflake procedure orchestrator',
      prompt:
        'Build a workflow that validates typed arguments, calls a Snowflake stored procedure, captures its output, and routes failures for operator review.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['automation', 'devops'],
    },
  ],
  skills: [
    {
      name: 'query-snowflake-data',
      description: 'Run a bounded parameterized Snowflake query and summarize its result.',
      content:
        '# Query Snowflake Data\n\n## Steps\n1. Confirm the warehouse and SQL statement.\n2. Use typed bindings for values.\n3. Execute the statement with a bounded row limit.\n4. If it is asynchronous, poll the handle and request only the needed partition.\n\n## Output\nReturn the rows, column meanings, and a concise summary.',
    },
    {
      name: 'sync-snowflake-rows',
      description: 'Insert, update, or upsert structured records safely in Snowflake.',
      content:
        '# Synchronize Snowflake Rows\n\n## Steps\n1. Confirm the target table and record keys.\n2. Keep the structured request within Sim’s request-size limit, and use Load Data for bulk ingestion.\n3. Choose insert, update, or upsert and provide match columns when needed.\n4. Report Snowflake DML statistics.\n\n## Output\nReturn inserted, updated, deleted, and total affected row counts.',
    },
    {
      name: 'load-snowflake-stage',
      description: 'Load files already present in a Snowflake stage into a table.',
      content:
        '# Load a Snowflake Stage\n\n## Steps\n1. Confirm the target table and existing stage path.\n2. Select the named file format and COPY options.\n3. Run the staged load.\n4. Review every returned file status before reporting success.\n\n## Output\nSummarize loaded and rejected files and any COPY errors.',
    },
    {
      name: 'monitor-snowflake-tasks',
      description:
        'Inspect Snowflake task history, diagnose failed runs, and pause or resume a task.',
      content:
        '# Monitor Snowflake Tasks\n\n## Steps\n1. Query the relevant time window within seven days.\n2. Filter to failures when appropriate.\n3. Get the selected run by query ID.\n4. Retrieve output only when it remains available and access permits it.\n5. Suspend a task to stop its schedule, and resume it once the cause is fixed. Resume every child task before the root task of a task graph.\n\n## Output\nReturn run state, timing, query ID, a failure summary, and any schedule change made.',
    },
    {
      name: 'control-snowflake-warehouse',
      description: 'Inspect, resume, suspend, or resize a Snowflake warehouse.',
      content:
        '# Control a Snowflake Warehouse\n\n## Steps\n1. List or describe the target warehouse.\n2. Confirm its name and current state.\n3. Resume, suspend, or alter its size, auto-suspend, and auto-resume only when requested.\n4. Verify the statement completed.\n\n## Output\nReturn the warehouse name, prior state, requested action, and result.',
    },
    {
      name: 'export-snowflake-results',
      description: 'Unload a table or query result to files in a Snowflake stage.',
      content:
        '# Export Snowflake Results\n\n## Steps\n1. Confirm the destination table and the stage path, and whether existing files may be overwritten.\n2. To export a query result rather than a whole table, materialize it first — create a view or use CREATE TABLE AS SELECT via Execute SQL — then unload that object.\n3. Pick a named file format, and decide on column headings and whether one file or several.\n4. Run the unload and review the reported file count and row totals.\n\n## Output\nReturn the stage path, files written, and rows unloaded.',
    },
    {
      name: 'browse-snowflake-objects',
      description: 'Discover the databases, schemas, and tables a Snowflake credential can reach.',
      content:
        '# Browse Snowflake Objects\n\n## Steps\n1. List databases to find the one in scope.\n2. List schemas in that database, then tables in the chosen schema.\n3. Narrow long lists with a SQL LIKE pattern and a row limit.\n4. Introspect the chosen table when column types matter.\n\n## Output\nReturn the object names found and the qualified name of the one selected.',
    },
    {
      name: 'review-snowflake-history',
      description: 'Review recent query executions and staged-file loads to explain a failure.',
      content:
        '# Review Snowflake History\n\n## Steps\n1. For query problems, list query history over the window in question, optionally filtered to one user or warehouse, or to failures only. It reaches back seven days.\n2. For ingestion problems, list copy history for the target table. It requires a start time and reaches back fourteen days.\n3. Read the error message and file status on the offending rows.\n\n## Output\nReturn the failing statement or file, its error, and the likely cause.',
    },
    {
      name: 'audit-snowflake-schema',
      description: 'Inspect Snowflake tables and columns for schema review or drift detection.',
      content:
        '# Audit a Snowflake Schema\n\n## Steps\n1. Choose a database and optional schema or table filter.\n2. Decide whether views belong in scope.\n3. Introspect the bounded metadata result.\n4. Compare names, types, nullability, and ordering.\n\n## Output\nReturn the schema inventory and notable compatibility risks.',
    },
    {
      name: 'call-snowflake-procedure',
      description: 'Call a Snowflake stored procedure with explicitly typed arguments.',
      content:
        '# Call a Snowflake Procedure\n\n## Steps\n1. Confirm the fully qualified procedure and argument order.\n2. Assign each argument an explicit Snowflake binding type and string value.\n3. Execute the call and inspect its result.\n\n## Output\nReturn the procedure result and statement handle.',
    },
  ],
} as const satisfies BlockMeta
