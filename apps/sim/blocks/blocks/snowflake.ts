import { SnowflakeIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { parseOptionalJsonInput, parseOptionalNumberInput } from '@/blocks/utils'
import type { SnowflakeStatementResponse } from '@/tools/snowflake/types'

const sqlSubmissionOperations = [
  'execute_sql',
  'insert_rows',
  'update_rows',
  'upsert_rows',
  'delete_rows',
  'load_data',
  'list_warehouses',
  'get_warehouse',
  'resume_warehouse',
  'suspend_warehouse',
  'list_tasks',
  'get_task',
  'run_task',
  'list_task_runs',
  'get_task_run',
  'cancel_task_run',
  'get_task_run_output',
  'introspect_schema',
  'call_procedure',
]

const computeOperations = [
  'execute_sql',
  'insert_rows',
  'update_rows',
  'upsert_rows',
  'delete_rows',
  'load_data',
  'list_task_runs',
  'get_task_run',
  'cancel_task_run',
  'get_task_run_output',
  'introspect_schema',
  'call_procedure',
]

const maxRowsOperations = [
  'execute_sql',
  'load_data',
  'list_warehouses',
  'get_task_run_output',
  'introspect_schema',
  'call_procedure',
]

const dataOperations = ['insert_rows', 'update_rows', 'upsert_rows', 'delete_rows', 'load_data']
const taskDefinitionOperations = ['list_tasks', 'get_task', 'run_task']

function copyOnError(value: unknown, threshold: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (value !== 'SKIP_FILE_NUMBER' && value !== 'SKIP_FILE_PERCENT') return String(value)

  const number = parseOptionalNumberInput(threshold, 'Skip file threshold')
  if (number === undefined || number <= 0) {
    throw new Error('Skip file threshold must be greater than zero')
  }
  if (value === 'SKIP_FILE_PERCENT' && number > 100) {
    throw new Error('Skip file percentage must be between 1 and 100')
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
    'Connect with a Snowflake programmatic access token to execute SQL, synchronize structured rows, load staged data, manage warehouses and tasks, inspect schemas, and call stored procedures.',
  docsLink: 'https://docs.sim.ai/integrations/snowflake',
  category: 'tools',
  integrationType: IntegrationType.Databases,
  bgColor: '#F7FBFD',
  icon: SnowflakeIcon,
  subBlocks: [
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
        { label: 'List Warehouses', id: 'list_warehouses' },
        { label: 'Get Warehouse', id: 'get_warehouse' },
        { label: 'Resume Warehouse', id: 'resume_warehouse' },
        { label: 'Suspend Warehouse', id: 'suspend_warehouse' },
        { label: 'List Tasks', id: 'list_tasks' },
        { label: 'Get Task', id: 'get_task' },
        { label: 'Run Task', id: 'run_task' },
        { label: 'List Task Runs', id: 'list_task_runs' },
        { label: 'Get Task Run', id: 'get_task_run' },
        { label: 'Cancel Task Run', id: 'cancel_task_run' },
        { label: 'Get Task Run Output', id: 'get_task_run_output' },
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
    },
    {
      id: 'bindings',
      title: 'Bindings',
      type: 'code',
      placeholder: '{"1":{"type":"TEXT","value":"active"}}',
      condition: { field: 'operation', value: 'execute_sql' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON object keyed by 1-based binding position. Each value must contain a Snowflake binding type and a string value, for example {"1":{"type":"TEXT","value":"active"}}. Return ONLY the JSON object - no explanations, no extra text.',
        placeholder: 'Describe the values and Snowflake types to bind...',
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
      id: 'database',
      title: 'Database',
      type: 'short-input',
      placeholder: 'ANALYTICS',
      condition: {
        field: 'operation',
        value: [
          'execute_sql',
          ...dataOperations,
          ...taskDefinitionOperations,
          'introspect_schema',
          'call_procedure',
        ],
      },
      required: {
        field: 'operation',
        value: [
          ...dataOperations,
          ...taskDefinitionOperations,
          'introspect_schema',
          'call_procedure',
        ],
      },
    },
    {
      id: 'schema',
      title: 'Schema',
      type: 'short-input',
      placeholder: 'PUBLIC',
      condition: {
        field: 'operation',
        value: [
          'execute_sql',
          ...dataOperations,
          ...taskDefinitionOperations,
          'introspect_schema',
          'call_procedure',
        ],
      },
      required: {
        field: 'operation',
        value: [...dataOperations, ...taskDefinitionOperations, 'call_procedure'],
      },
    },
    {
      id: 'table',
      title: 'Table',
      type: 'short-input',
      placeholder: 'EVENTS',
      condition: { field: 'operation', value: [...dataOperations, 'introspect_schema'] },
      required: { field: 'operation', value: dataOperations },
    },
    {
      id: 'rows',
      title: 'Rows',
      type: 'code',
      placeholder: '[{"id":1,"status":"active"}]',
      condition: { field: 'operation', value: ['insert_rows', 'update_rows', 'upsert_rows'] },
      required: { field: 'operation', value: ['insert_rows', 'update_rows', 'upsert_rows'] },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a non-empty JSON array of flat row objects. Every row must have the same keys. Use Load Data instead for bulk ingestion from staged files. Return ONLY the JSON array - no explanations, no extra text.',
        placeholder: 'Describe the records to write...',
      },
    },
    {
      id: 'matchColumns',
      title: 'Match Columns',
      type: 'code',
      placeholder: '["id"]',
      condition: { field: 'operation', value: ['update_rows', 'upsert_rows'] },
      required: { field: 'operation', value: ['update_rows', 'upsert_rows'] },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON array containing the row column names that uniquely match target records, for example ["tenant_id","id"]. Return ONLY the JSON array - no explanations, no extra text.',
        placeholder: 'Describe the columns that identify a row...',
      },
    },
    {
      id: 'filters',
      title: 'Equality Filters',
      type: 'code',
      placeholder: '{"status":"expired","tenant_id":42}',
      condition: { field: 'operation', value: 'delete_rows' },
      required: { field: 'operation', value: 'delete_rows' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a non-empty JSON object of column equality filters. All filters are combined with AND. Return ONLY the JSON object - no explanations, no extra text.',
        placeholder: 'Describe the exact rows to delete...',
      },
    },
    {
      id: 'stagePath',
      title: 'Stage Path',
      type: 'short-input',
      placeholder: '@RAW_STAGE/2026/08',
      condition: { field: 'operation', value: 'load_data' },
      required: { field: 'operation', value: 'load_data' },
    },
    {
      id: 'fileFormat',
      title: 'Named File Format',
      type: 'short-input',
      placeholder: 'ANALYTICS.PUBLIC.CSV_FORMAT',
      condition: { field: 'operation', value: 'load_data' },
      mode: 'advanced',
    },
    {
      id: 'pattern',
      title: 'File Pattern',
      type: 'short-input',
      placeholder: '.*[.]csv',
      condition: { field: 'operation', value: 'load_data' },
      mode: 'advanced',
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
      mode: 'advanced',
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
      id: 'warehouseName',
      title: 'Warehouse Name',
      type: 'short-input',
      placeholder: 'COMPUTE_WH',
      condition: {
        field: 'operation',
        value: ['get_warehouse', 'resume_warehouse', 'suspend_warehouse'],
      },
      required: {
        field: 'operation',
        value: ['get_warehouse', 'resume_warehouse', 'suspend_warehouse'],
      },
    },
    {
      id: 'nameLike',
      title: 'Name Pattern',
      type: 'short-input',
      placeholder: 'ETL%',
      condition: { field: 'operation', value: ['list_warehouses', 'list_tasks'] },
      mode: 'advanced',
    },
    {
      id: 'taskName',
      title: 'Task Name',
      type: 'short-input',
      placeholder: 'DAILY_LOAD',
      condition: {
        field: 'operation',
        value: ['get_task', 'run_task', 'list_task_runs', 'get_task_run'],
      },
      required: { field: 'operation', value: ['get_task', 'run_task'] },
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
      condition: { field: 'operation', value: ['list_tasks', 'list_task_runs'] },
      mode: 'advanced',
    },
    {
      id: 'startTime',
      title: 'Scheduled Time From',
      type: 'short-input',
      placeholder: '2026-08-01T00:00:00Z',
      condition: { field: 'operation', value: ['list_task_runs', 'get_task_run'] },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Convert the requested start date and time to an ISO 8601 timestamp within the last seven days. Return ONLY the timestamp - no explanations, no extra text.',
        placeholder: 'Describe the beginning of the task history window...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'endTime',
      title: 'Scheduled Time To',
      type: 'short-input',
      placeholder: '2026-08-07T00:00:00Z',
      condition: { field: 'operation', value: ['list_task_runs', 'get_task_run'] },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Convert the requested end date and time to an ISO 8601 timestamp. Return ONLY the timestamp - no explanations, no extra text.',
        placeholder: 'Describe the end of the task history window...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'errorOnly',
      title: 'Errors Only',
      type: 'switch',
      condition: { field: 'operation', value: 'list_task_runs' },
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
      id: 'includeViews',
      title: 'Include Views',
      type: 'switch',
      condition: { field: 'operation', value: 'introspect_schema' },
      mode: 'advanced',
    },
    {
      id: 'procedureName',
      title: 'Procedure Name',
      type: 'short-input',
      placeholder: 'REFRESH_MODEL',
      condition: { field: 'operation', value: 'call_procedure' },
      required: { field: 'operation', value: 'call_procedure' },
    },
    {
      id: 'procedureArguments',
      title: 'Procedure Arguments',
      type: 'code',
      placeholder: '[{"type":"TEXT","value":"daily"}]',
      condition: { field: 'operation', value: 'call_procedure' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an ordered JSON array of Snowflake procedure bindings. Each item must contain a supported Snowflake binding type and a string value, for example {"type":"TEXT","value":"daily"}. Return ONLY the JSON array - no explanations, no extra text.',
        placeholder: 'Describe the procedure arguments in order...',
      },
    },
    {
      id: 'warehouse',
      title: 'Execution Warehouse',
      type: 'short-input',
      placeholder: 'COMPUTE_WH',
      condition: { field: 'operation', value: computeOperations },
      mode: 'advanced',
    },
    {
      id: 'role',
      title: 'Execution Role',
      type: 'short-input',
      placeholder: 'ANALYST',
      condition: { field: 'operation', value: sqlSubmissionOperations },
      mode: 'advanced',
    },
    {
      id: 'statementTimeoutSeconds',
      title: 'Timeout (seconds)',
      type: 'short-input',
      placeholder: '60',
      condition: { field: 'operation', value: sqlSubmissionOperations },
      mode: 'advanced',
    },
    {
      id: 'maxRows',
      title: 'Maximum Rows',
      type: 'short-input',
      placeholder: '1000',
      condition: {
        field: 'operation',
        value: maxRowsOperations,
      },
      mode: 'advanced',
    },
    {
      id: 'host',
      title: 'Account Host',
      type: 'short-input',
      placeholder: 'myorg-myaccount.snowflakecomputing.com',
      required: true,
    },
    {
      id: 'apiKey',
      title: 'Programmatic Access Token',
      type: 'short-input',
      placeholder: 'Enter your Snowflake PAT',
      password: true,
      required: true,
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
      'snowflake_list_warehouses',
      'snowflake_get_warehouse',
      'snowflake_resume_warehouse',
      'snowflake_suspend_warehouse',
      'snowflake_list_tasks',
      'snowflake_get_task',
      'snowflake_run_task',
      'snowflake_list_task_runs',
      'snowflake_get_task_run',
      'snowflake_cancel_task_run',
      'snowflake_get_task_run_output',
      'snowflake_introspect_schema',
      'snowflake_call_procedure',
    ],
    config: {
      tool: (params) => `snowflake_${params.operation}`,
      params: (params) => {
        const operation = String(params.operation)
        const result: Record<string, unknown> = {}

        if (sqlSubmissionOperations.includes(operation)) {
          result.statementTimeoutSeconds = parseOptionalNumberInput(
            params.statementTimeoutSeconds,
            'Statement timeout'
          )
        }
        if (maxRowsOperations.includes(operation)) {
          result.maxRows = parseOptionalNumberInput(params.maxRows, 'Maximum result rows')
        }

        switch (operation) {
          case 'execute_sql':
            result.bindings = parseOptionalJsonInput(params.bindings, 'Bindings')
            break
          case 'get_statement':
            result.partition = parseOptionalNumberInput(params.partition, 'Partition')
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
            result.onError = copyOnError(params.onError, params.onErrorThreshold)
            break
          case 'list_tasks':
            result.limit = parseOptionalNumberInput(params.limit, 'Task limit')
            break
          case 'list_task_runs':
            result.limit = parseOptionalNumberInput(params.limit, 'Task run limit')
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
    host: { type: 'string', description: 'Snowflake account hostname' },
    apiKey: { type: 'string', description: 'Snowflake programmatic access token' },
    statement: { type: 'string', description: 'Single SQL statement' },
    bindings: {
      type: 'string',
      description: 'Typed SQL bindings as a JSON object keyed by 1-based positions',
    },
    async: { type: 'boolean', description: 'Run the SQL statement asynchronously' },
    statementHandle: { type: 'string', description: 'Snowflake SQL API statement handle' },
    partition: { type: 'number', description: 'Zero-based result partition' },
    database: { type: 'string', description: 'Snowflake database name' },
    schema: { type: 'string', description: 'Snowflake schema name' },
    table: { type: 'string', description: 'Snowflake table name' },
    rows: { type: 'string', description: 'Structured rows as a JSON array' },
    matchColumns: { type: 'string', description: 'Match columns as a JSON array' },
    filters: { type: 'string', description: 'Equality filters as a JSON object' },
    stagePath: { type: 'string', description: 'Existing Snowflake stage path' },
    fileFormat: { type: 'string', description: 'Named Snowflake file format' },
    pattern: { type: 'string', description: 'COPY file selection pattern' },
    onError: { type: 'string', description: 'COPY error handling policy' },
    onErrorThreshold: { type: 'number', description: 'COPY skip-file error threshold' },
    purge: { type: 'boolean', description: 'Purge successfully loaded staged files' },
    force: { type: 'boolean', description: 'Force staged files to load again' },
    matchByColumnName: { type: 'string', description: 'COPY column-name matching policy' },
    warehouseName: { type: 'string', description: 'Warehouse to retrieve or change' },
    nameLike: { type: 'string', description: 'SQL LIKE pattern for object names' },
    taskName: { type: 'string', description: 'Snowflake task name' },
    retryLast: { type: 'boolean', description: 'Retry the last failed task graph' },
    limit: { type: 'number', description: 'Maximum list results' },
    startTime: { type: 'string', description: 'Task history start timestamp' },
    endTime: { type: 'string', description: 'Task history end timestamp' },
    errorOnly: { type: 'boolean', description: 'Only return failed task runs' },
    queryId: { type: 'string', description: 'Task run query UUID' },
    includeViews: { type: 'boolean', description: 'Include views in schema introspection' },
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
        'Completed result partition ({columns, rows, totalRows, currentPartition, nextPartition, truncated})',
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
      description: 'Inspect Snowflake task history and diagnose failed runs.',
      content:
        '# Monitor Snowflake Tasks\n\n## Steps\n1. Query the relevant time window within seven days.\n2. Filter to failures when appropriate.\n3. Get the selected run by query ID.\n4. Retrieve output only when it remains available and access permits it.\n\n## Output\nReturn run state, timing, query ID, and a failure summary.',
    },
    {
      name: 'control-snowflake-warehouse',
      description: 'Inspect and deliberately resume or suspend a Snowflake warehouse.',
      content:
        '# Control a Snowflake Warehouse\n\n## Steps\n1. List or describe the target warehouse.\n2. Confirm its name and current state.\n3. Resume or suspend only when requested.\n4. Verify the statement completed.\n\n## Output\nReturn the warehouse name, prior state, requested action, and result.',
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
