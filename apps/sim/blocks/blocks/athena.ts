import { AthenaIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { IntegrationType } from '@/blocks/types'
import type {
  AthenaBatchGetNamedQueryResponse,
  AthenaBatchGetPreparedStatementResponse,
  AthenaBatchGetQueryExecutionResponse,
  AthenaCreateNamedQueryResponse,
  AthenaCreatePreparedStatementResponse,
  AthenaDeleteNamedQueryResponse,
  AthenaDeletePreparedStatementResponse,
  AthenaGetDatabaseResponse,
  AthenaGetDataCatalogResponse,
  AthenaGetNamedQueryResponse,
  AthenaGetPreparedStatementResponse,
  AthenaGetQueryExecutionResponse,
  AthenaGetQueryResultsResponse,
  AthenaGetQueryRuntimeStatisticsResponse,
  AthenaGetTableMetadataResponse,
  AthenaGetWorkGroupResponse,
  AthenaListDatabasesResponse,
  AthenaListDataCatalogsResponse,
  AthenaListNamedQueriesResponse,
  AthenaListPreparedStatementsResponse,
  AthenaListQueryExecutionsResponse,
  AthenaListTableMetadataResponse,
  AthenaListWorkGroupsResponse,
  AthenaStartQueryResponse,
  AthenaStopQueryResponse,
  AthenaUpdateNamedQueryResponse,
  AthenaUpdatePreparedStatementResponse,
} from '@/tools/athena/types'

/**
 * Normalizes a switch value that may arrive as a boolean or as the strings 'true' / 'false'.
 */
function parseBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  return undefined
}

export const AthenaBlock: BlockConfig<
  | AthenaStartQueryResponse
  | AthenaGetQueryExecutionResponse
  | AthenaGetQueryResultsResponse
  | AthenaGetQueryRuntimeStatisticsResponse
  | AthenaStopQueryResponse
  | AthenaListQueryExecutionsResponse
  | AthenaBatchGetQueryExecutionResponse
  | AthenaCreateNamedQueryResponse
  | AthenaGetNamedQueryResponse
  | AthenaBatchGetNamedQueryResponse
  | AthenaUpdateNamedQueryResponse
  | AthenaListNamedQueriesResponse
  | AthenaDeleteNamedQueryResponse
  | AthenaCreatePreparedStatementResponse
  | AthenaGetPreparedStatementResponse
  | AthenaBatchGetPreparedStatementResponse
  | AthenaUpdatePreparedStatementResponse
  | AthenaListPreparedStatementsResponse
  | AthenaDeletePreparedStatementResponse
  | AthenaListDataCatalogsResponse
  | AthenaGetDataCatalogResponse
  | AthenaListDatabasesResponse
  | AthenaGetDatabaseResponse
  | AthenaListTableMetadataResponse
  | AthenaGetTableMetadataResponse
  | AthenaListWorkGroupsResponse
  | AthenaGetWorkGroupResponse
> = {
  type: 'athena',
  name: 'Athena',
  description: 'Run SQL queries on data in Amazon S3 using AWS Athena',
  longDescription:
    'Integrate AWS Athena into workflows. Execute SQL queries against data in S3, check query status and runtime statistics, retrieve results, manage named queries and prepared statements, and inspect data catalogs, databases, tables, and workgroups. Requires AWS access key and secret access key.',
  docsLink: 'https://docs.sim.ai/integrations/athena',
  category: 'tools',
  integrationType: IntegrationType.Analytics,
  bgColor: 'linear-gradient(45deg, #4D27A8 0%, #A166FF 100%)',
  iconColor: '#A166FF',
  icon: AthenaIcon,
  canvasPresentation: {
    defaultTitle: 'Athena',
    sentences: {
      byOperation: {
        start_query: [
          { text: 'Run', field: 'queryString', core: true },
          { text: 'on database', field: 'database' },
        ],
        get_query_execution: [
          { text: 'Read the status of query', field: 'queryExecutionId', core: true },
        ],
        get_query_results: [
          { text: 'Fetch the results of query', field: 'queryExecutionId', core: true },
          { text: ', up to', field: 'maxResults', after: 'rows' },
        ],
        stop_query: [{ text: 'Stop query', field: 'queryExecutionId', core: true }],
        list_query_executions: [
          'List recent query executions',
          { text: ', in workgroup', field: 'workGroup' },
          { text: ', up to', field: 'maxResults' },
        ],
        batch_get_query_execution: [
          {
            text: 'Read the status of every query in',
            field: 'queryExecutionIds',
            core: true,
          },
        ],
        create_named_query: [
          { text: 'Save named query', field: 'queryName', core: true },
          { text: 'on database', field: 'database' },
        ],
        get_named_query: [{ text: 'Read named query', field: 'namedQueryId', core: true }],
        list_named_queries: [
          'List saved named queries',
          { text: ', in workgroup', field: 'workGroup' },
          { text: ', up to', field: 'maxResults' },
        ],
        delete_named_query: [{ text: 'Delete named query', field: 'namedQueryId', core: true }],
        list_databases: [
          'List databases',
          { text: ', in catalog', field: 'catalogName' },
          { text: ', up to', field: 'maxResults' },
        ],
        list_table_metadata: [
          'List tables and their columns',
          { text: ', in database', field: 'databaseName' },
          { text: ', matching', field: 'expression' },
        ],
        get_query_runtime_statistics: [
          { text: 'Read runtime statistics for query', field: 'queryExecutionId', core: true },
        ],
        batch_get_named_query: [
          { text: 'Read every named query in', field: 'namedQueryIds', core: true },
        ],
        update_named_query: [
          { text: 'Update named query', field: 'namedQueryId', core: true },
          { text: 'to', field: 'queryName' },
        ],
        get_database: [
          { text: 'Read database', field: 'databaseName', core: true },
          { text: 'in catalog', field: 'catalogName' },
        ],
        get_table_metadata: [
          { text: 'Read the schema of table', field: 'tableName', core: true },
          { text: 'in database', field: 'databaseName' },
        ],
        list_data_catalogs: ['List data catalogs', { text: ', up to', field: 'maxResults' }],
        get_data_catalog: [{ text: 'Read data catalog', field: 'catalogName', core: true }],
        list_work_groups: ['List workgroups', { text: ', up to', field: 'maxResults' }],
        get_work_group: [{ text: 'Read workgroup', field: 'workGroupName', core: true }],
        create_prepared_statement: [
          { text: 'Create prepared statement', field: 'statementName', core: true },
          { text: 'in workgroup', field: 'workGroupName' },
        ],
        get_prepared_statement: [
          { text: 'Read prepared statement', field: 'statementName', core: true },
          { text: 'in workgroup', field: 'workGroupName' },
        ],
        update_prepared_statement: [
          { text: 'Update prepared statement', field: 'statementName', core: true },
          { text: 'in workgroup', field: 'workGroupName' },
        ],
        delete_prepared_statement: [
          { text: 'Delete prepared statement', field: 'statementName', core: true },
          { text: 'from workgroup', field: 'workGroupName' },
        ],
        list_prepared_statements: [
          'List prepared statements',
          { text: 'in workgroup', field: 'workGroupName', core: true },
          { text: ', up to', field: 'maxResults' },
        ],
        batch_get_prepared_statement: [
          {
            text: 'Read every prepared statement in',
            field: 'preparedStatementNames',
            core: true,
          },
          { text: 'from workgroup', field: 'workGroupName' },
        ],
      },
    },
  },
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Start Query', id: 'start_query' },
        { label: 'Get Query Execution', id: 'get_query_execution' },
        { label: 'Get Query Results', id: 'get_query_results' },
        { label: 'Get Query Runtime Statistics', id: 'get_query_runtime_statistics' },
        { label: 'Stop Query', id: 'stop_query' },
        { label: 'List Query Executions', id: 'list_query_executions' },
        { label: 'Batch Get Query Executions', id: 'batch_get_query_execution' },
        { label: 'Create Named Query', id: 'create_named_query' },
        { label: 'Get Named Query', id: 'get_named_query' },
        { label: 'Batch Get Named Queries', id: 'batch_get_named_query' },
        { label: 'Update Named Query', id: 'update_named_query' },
        { label: 'List Named Queries', id: 'list_named_queries' },
        { label: 'Delete Named Query', id: 'delete_named_query' },
        { label: 'Create Prepared Statement', id: 'create_prepared_statement' },
        { label: 'Get Prepared Statement', id: 'get_prepared_statement' },
        { label: 'Batch Get Prepared Statements', id: 'batch_get_prepared_statement' },
        { label: 'Update Prepared Statement', id: 'update_prepared_statement' },
        { label: 'List Prepared Statements', id: 'list_prepared_statements' },
        { label: 'Delete Prepared Statement', id: 'delete_prepared_statement' },
        { label: 'List Data Catalogs', id: 'list_data_catalogs' },
        { label: 'Get Data Catalog', id: 'get_data_catalog' },
        { label: 'List Databases', id: 'list_databases' },
        { label: 'Get Database', id: 'get_database' },
        { label: 'List Table Metadata', id: 'list_table_metadata' },
        { label: 'Get Table Metadata', id: 'get_table_metadata' },
        { label: 'List Workgroups', id: 'list_work_groups' },
        { label: 'Get Workgroup', id: 'get_work_group' },
      ],
      value: () => 'start_query',
    },
    {
      id: 'awsRegion',
      title: 'AWS Region',
      type: 'short-input',
      placeholder: 'us-east-1',
      required: true,
    },
    {
      id: 'awsAccessKeyId',
      title: 'AWS Access Key ID',
      type: 'short-input',
      placeholder: 'AKIA...',
      password: true,
      required: true,
    },
    {
      id: 'awsSecretAccessKey',
      title: 'AWS Secret Access Key',
      type: 'short-input',
      placeholder: 'Your secret access key',
      password: true,
      required: true,
    },
    {
      id: 'queryString',
      title: 'SQL Query',
      type: 'code',
      placeholder: 'SELECT * FROM my_table LIMIT 10',
      condition: {
        field: 'operation',
        value: [
          'start_query',
          'create_named_query',
          'update_named_query',
          'create_prepared_statement',
          'update_prepared_statement',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'start_query',
          'create_named_query',
          'update_named_query',
          'create_prepared_statement',
          'update_prepared_statement',
        ],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate an SQL query for AWS Athena based on the user's description.
Athena uses Trino/Presto SQL syntax. Common patterns:
- SELECT * FROM "database"."table" LIMIT 10
- SELECT column1, COUNT(*) FROM table GROUP BY column1
- SELECT * FROM table WHERE date_column > DATE '2024-01-01'
- CREATE TABLE new_table AS SELECT ... FROM source_table
- SELECT * FROM table WHERE column IN ('value1', 'value2')
- Prepared statements use ? placeholders: SELECT * FROM table WHERE region = ? AND day > ?

Return ONLY the SQL query — no explanations, no markdown code blocks.`,
        placeholder: 'Describe what data you want to query...',
      },
    },
    {
      id: 'database',
      title: 'Database',
      type: 'short-input',
      placeholder: 'my_database',
      condition: { field: 'operation', value: ['start_query', 'create_named_query'] },
      required: { field: 'operation', value: 'create_named_query' },
    },
    {
      id: 'catalog',
      title: 'Data Catalog',
      type: 'short-input',
      placeholder: 'AwsDataCatalog',
      condition: { field: 'operation', value: 'start_query' },
      mode: 'advanced',
    },
    {
      id: 'outputLocation',
      title: 'Output Location (S3)',
      type: 'short-input',
      placeholder: 's3://my-bucket/athena-results/',
      condition: { field: 'operation', value: 'start_query' },
      mode: 'advanced',
    },
    {
      id: 'workGroup',
      title: 'Workgroup',
      type: 'short-input',
      placeholder: 'primary',
      condition: {
        field: 'operation',
        value: [
          'start_query',
          'list_query_executions',
          'create_named_query',
          'list_named_queries',
          'list_databases',
          'list_table_metadata',
          'list_data_catalogs',
          'get_data_catalog',
          'get_database',
          'get_table_metadata',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'workGroupName',
      title: 'Workgroup',
      type: 'short-input',
      placeholder: 'primary',
      condition: {
        field: 'operation',
        value: [
          'get_work_group',
          'create_prepared_statement',
          'get_prepared_statement',
          'batch_get_prepared_statement',
          'update_prepared_statement',
          'list_prepared_statements',
          'delete_prepared_statement',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'get_work_group',
          'create_prepared_statement',
          'get_prepared_statement',
          'batch_get_prepared_statement',
          'update_prepared_statement',
          'list_prepared_statements',
          'delete_prepared_statement',
        ],
      },
    },
    {
      id: 'executionParameters',
      title: 'Execution Parameters',
      type: 'long-input',
      placeholder: '["2024-01-01", "US"] — values for ? placeholders, in order',
      condition: { field: 'operation', value: 'start_query' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate the execution parameter values for an AWS Athena parameterized query based on the user's description.
The values fill the ? placeholders in the query in order, so list them in placeholder order.
Every value is a string, including numbers and dates, e.g. ["2024-01-01", "US", "100"].

Return ONLY a JSON array of strings — no explanations, no markdown code blocks.`,
        placeholder: 'Describe the values for each ? placeholder in order...',
      },
    },
    {
      id: 'resultReuseEnabled',
      title: 'Reuse Previous Results',
      type: 'switch',
      condition: { field: 'operation', value: 'start_query' },
      mode: 'advanced',
    },
    {
      id: 'resultReuseMaxAgeInMinutes',
      title: 'Max Result Age (minutes)',
      type: 'short-input',
      placeholder: '60',
      condition: {
        field: 'operation',
        value: 'start_query',
        and: { field: 'resultReuseEnabled', value: true },
      },
      mode: 'advanced',
    },
    {
      id: 'queryExecutionId',
      title: 'Query Execution ID',
      type: 'short-input',
      placeholder: 'e.g., a1b2c3d4-5678-90ab-cdef-example11111',
      condition: {
        field: 'operation',
        value: [
          'get_query_execution',
          'get_query_results',
          'get_query_runtime_statistics',
          'stop_query',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'get_query_execution',
          'get_query_results',
          'get_query_runtime_statistics',
          'stop_query',
        ],
      },
    },
    {
      id: 'queryExecutionIds',
      title: 'Query Execution IDs',
      type: 'long-input',
      placeholder: 'Comma-separated IDs, e.g. a1b2c3d4-..., e5f6g7h8-... (up to 50)',
      condition: { field: 'operation', value: 'batch_get_query_execution' },
      required: { field: 'operation', value: 'batch_get_query_execution' },
    },
    {
      id: 'namedQueryId',
      title: 'Named Query ID',
      type: 'short-input',
      placeholder: 'e.g., a1b2c3d4-5678-90ab-cdef-example11111',
      condition: {
        field: 'operation',
        value: ['get_named_query', 'update_named_query', 'delete_named_query'],
      },
      required: {
        field: 'operation',
        value: ['get_named_query', 'update_named_query', 'delete_named_query'],
      },
    },
    {
      id: 'namedQueryIds',
      title: 'Named Query IDs',
      type: 'long-input',
      placeholder: 'Comma-separated IDs, e.g. a1b2c3d4-..., e5f6g7h8-... (up to 50)',
      condition: { field: 'operation', value: 'batch_get_named_query' },
      required: { field: 'operation', value: 'batch_get_named_query' },
    },
    {
      id: 'statementName',
      title: 'Statement Name',
      type: 'short-input',
      placeholder: 'my_prepared_statement',
      condition: {
        field: 'operation',
        value: [
          'create_prepared_statement',
          'get_prepared_statement',
          'update_prepared_statement',
          'delete_prepared_statement',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'create_prepared_statement',
          'get_prepared_statement',
          'update_prepared_statement',
          'delete_prepared_statement',
        ],
      },
    },
    {
      id: 'preparedStatementNames',
      title: 'Statement Names',
      type: 'long-input',
      placeholder: 'Comma-separated names, e.g. daily_report, region_summary (up to 256)',
      condition: { field: 'operation', value: 'batch_get_prepared_statement' },
      required: { field: 'operation', value: 'batch_get_prepared_statement' },
    },
    {
      id: 'catalogName',
      title: 'Data Catalog',
      type: 'short-input',
      placeholder: 'AwsDataCatalog',
      condition: {
        field: 'operation',
        value: [
          'list_databases',
          'get_database',
          'list_table_metadata',
          'get_table_metadata',
          'get_data_catalog',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'list_databases',
          'get_database',
          'list_table_metadata',
          'get_table_metadata',
          'get_data_catalog',
        ],
      },
    },
    {
      id: 'databaseName',
      title: 'Database',
      type: 'short-input',
      placeholder: 'my_database',
      condition: {
        field: 'operation',
        value: ['get_database', 'list_table_metadata', 'get_table_metadata'],
      },
      required: {
        field: 'operation',
        value: ['get_database', 'list_table_metadata', 'get_table_metadata'],
      },
    },
    {
      id: 'tableName',
      title: 'Table',
      type: 'short-input',
      placeholder: 'my_table',
      condition: { field: 'operation', value: 'get_table_metadata' },
      required: { field: 'operation', value: 'get_table_metadata' },
    },
    {
      id: 'expression',
      title: 'Table Name Filter (regex)',
      type: 'short-input',
      placeholder: 'my_table_.*',
      condition: { field: 'operation', value: 'list_table_metadata' },
      mode: 'advanced',
    },
    {
      id: 'queryName',
      title: 'Query Name',
      type: 'short-input',
      placeholder: 'My Saved Query',
      condition: { field: 'operation', value: ['create_named_query', 'update_named_query'] },
      required: { field: 'operation', value: ['create_named_query', 'update_named_query'] },
    },
    {
      id: 'queryDescription',
      title: 'Description',
      type: 'short-input',
      placeholder: 'Description of what this query does',
      condition: {
        field: 'operation',
        value: [
          'create_named_query',
          'update_named_query',
          'create_prepared_statement',
          'update_prepared_statement',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'maxResults',
      title: 'Max Results',
      type: 'short-input',
      placeholder: '50',
      condition: {
        field: 'operation',
        value: [
          'get_query_results',
          'list_query_executions',
          'list_named_queries',
          'list_prepared_statements',
          'list_data_catalogs',
          'list_databases',
          'list_table_metadata',
          'list_work_groups',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'nextToken',
      title: 'Pagination Token',
      type: 'short-input',
      placeholder: 'Token from previous request',
      condition: {
        field: 'operation',
        value: [
          'get_query_results',
          'list_query_executions',
          'list_named_queries',
          'list_prepared_statements',
          'list_data_catalogs',
          'list_databases',
          'list_table_metadata',
          'list_work_groups',
        ],
      },
      mode: 'advanced',
    },
  ],
  tools: {
    access: [
      'athena_start_query',
      'athena_get_query_execution',
      'athena_get_query_results',
      'athena_stop_query',
      'athena_list_query_executions',
      'athena_batch_get_query_execution',
      'athena_create_named_query',
      'athena_get_named_query',
      'athena_list_named_queries',
      'athena_delete_named_query',
      'athena_list_databases',
      'athena_list_table_metadata',
      'athena_get_query_runtime_statistics',
      'athena_batch_get_named_query',
      'athena_update_named_query',
      'athena_create_prepared_statement',
      'athena_get_prepared_statement',
      'athena_batch_get_prepared_statement',
      'athena_update_prepared_statement',
      'athena_list_prepared_statements',
      'athena_delete_prepared_statement',
      'athena_list_data_catalogs',
      'athena_get_data_catalog',
      'athena_get_database',
      'athena_get_table_metadata',
      'athena_list_work_groups',
      'athena_get_work_group',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'start_query':
            return 'athena_start_query'
          case 'get_query_execution':
            return 'athena_get_query_execution'
          case 'get_query_results':
            return 'athena_get_query_results'
          case 'stop_query':
            return 'athena_stop_query'
          case 'list_query_executions':
            return 'athena_list_query_executions'
          case 'batch_get_query_execution':
            return 'athena_batch_get_query_execution'
          case 'create_named_query':
            return 'athena_create_named_query'
          case 'get_named_query':
            return 'athena_get_named_query'
          case 'list_named_queries':
            return 'athena_list_named_queries'
          case 'delete_named_query':
            return 'athena_delete_named_query'
          case 'list_databases':
            return 'athena_list_databases'
          case 'list_table_metadata':
            return 'athena_list_table_metadata'
          case 'get_query_runtime_statistics':
            return 'athena_get_query_runtime_statistics'
          case 'batch_get_named_query':
            return 'athena_batch_get_named_query'
          case 'update_named_query':
            return 'athena_update_named_query'
          case 'create_prepared_statement':
            return 'athena_create_prepared_statement'
          case 'get_prepared_statement':
            return 'athena_get_prepared_statement'
          case 'batch_get_prepared_statement':
            return 'athena_batch_get_prepared_statement'
          case 'update_prepared_statement':
            return 'athena_update_prepared_statement'
          case 'list_prepared_statements':
            return 'athena_list_prepared_statements'
          case 'delete_prepared_statement':
            return 'athena_delete_prepared_statement'
          case 'list_data_catalogs':
            return 'athena_list_data_catalogs'
          case 'get_data_catalog':
            return 'athena_get_data_catalog'
          case 'get_database':
            return 'athena_get_database'
          case 'get_table_metadata':
            return 'athena_get_table_metadata'
          case 'list_work_groups':
            return 'athena_list_work_groups'
          case 'get_work_group':
            return 'athena_get_work_group'
          default:
            throw new Error(`Invalid Athena operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const { operation, maxResults, ...rest } = params

        const awsRegion = rest.awsRegion
        const awsAccessKeyId = rest.awsAccessKeyId
        const awsSecretAccessKey = rest.awsSecretAccessKey
        const parsedMaxResults = maxResults ? Number.parseInt(String(maxResults), 10) : undefined
        const connection = { awsRegion, awsAccessKeyId, awsSecretAccessKey }
        const resultReuseEnabled = parseBoolean(rest.resultReuseEnabled)
        const resultReuseMaxAgeInMinutes =
          rest.resultReuseMaxAgeInMinutes !== undefined &&
          rest.resultReuseMaxAgeInMinutes !== null &&
          rest.resultReuseMaxAgeInMinutes !== ''
            ? Number.parseInt(String(rest.resultReuseMaxAgeInMinutes), 10)
            : undefined

        switch (operation) {
          case 'start_query':
            return {
              awsRegion,
              awsAccessKeyId,
              awsSecretAccessKey,
              queryString: rest.queryString,
              ...(rest.database && { database: rest.database }),
              ...(rest.catalog && { catalog: rest.catalog }),
              ...(rest.outputLocation && { outputLocation: rest.outputLocation }),
              ...(rest.workGroup && { workGroup: rest.workGroup }),
              ...(rest.executionParameters && { executionParameters: rest.executionParameters }),
              ...(resultReuseEnabled !== undefined && { resultReuseEnabled }),
              ...(resultReuseEnabled &&
                resultReuseMaxAgeInMinutes !== undefined && { resultReuseMaxAgeInMinutes }),
            }

          case 'get_query_execution':
            if (!rest.queryExecutionId) {
              throw new Error('Query execution ID is required')
            }
            return {
              awsRegion,
              awsAccessKeyId,
              awsSecretAccessKey,
              queryExecutionId: rest.queryExecutionId,
            }

          case 'get_query_results':
            if (!rest.queryExecutionId) {
              throw new Error('Query execution ID is required')
            }
            return {
              awsRegion,
              awsAccessKeyId,
              awsSecretAccessKey,
              queryExecutionId: rest.queryExecutionId,
              ...(parsedMaxResults !== undefined && { maxResults: parsedMaxResults }),
              ...(rest.nextToken && { nextToken: rest.nextToken }),
            }

          case 'stop_query':
            if (!rest.queryExecutionId) {
              throw new Error('Query execution ID is required')
            }
            return {
              awsRegion,
              awsAccessKeyId,
              awsSecretAccessKey,
              queryExecutionId: rest.queryExecutionId,
            }

          case 'list_query_executions':
            return {
              awsRegion,
              awsAccessKeyId,
              awsSecretAccessKey,
              ...(rest.workGroup && { workGroup: rest.workGroup }),
              ...(parsedMaxResults !== undefined && { maxResults: parsedMaxResults }),
              ...(rest.nextToken && { nextToken: rest.nextToken }),
            }

          case 'create_named_query': {
            if (!rest.queryName) {
              throw new Error('Query name is required')
            }
            if (!rest.database) {
              throw new Error('Database is required')
            }
            if (!rest.queryString) {
              throw new Error('SQL query string is required')
            }
            return {
              awsRegion,
              awsAccessKeyId,
              awsSecretAccessKey,
              name: rest.queryName,
              database: rest.database,
              queryString: rest.queryString,
              ...(rest.queryDescription && { description: rest.queryDescription }),
              ...(rest.workGroup && { workGroup: rest.workGroup }),
            }
          }

          case 'get_named_query':
            if (!rest.namedQueryId) {
              throw new Error('Named query ID is required')
            }
            return {
              awsRegion,
              awsAccessKeyId,
              awsSecretAccessKey,
              namedQueryId: rest.namedQueryId,
            }

          case 'list_named_queries':
            return {
              awsRegion,
              awsAccessKeyId,
              awsSecretAccessKey,
              ...(rest.workGroup && { workGroup: rest.workGroup }),
              ...(parsedMaxResults !== undefined && { maxResults: parsedMaxResults }),
              ...(rest.nextToken && { nextToken: rest.nextToken }),
            }

          case 'delete_named_query':
            if (!rest.namedQueryId) {
              throw new Error('Named query ID is required')
            }
            return {
              awsRegion,
              awsAccessKeyId,
              awsSecretAccessKey,
              namedQueryId: rest.namedQueryId,
            }

          case 'batch_get_query_execution':
            if (!rest.queryExecutionIds) {
              throw new Error('Query execution IDs are required')
            }
            return {
              awsRegion,
              awsAccessKeyId,
              awsSecretAccessKey,
              queryExecutionIds: rest.queryExecutionIds,
            }

          case 'list_databases':
            if (!rest.catalogName) {
              throw new Error('Data catalog name is required')
            }
            return {
              awsRegion,
              awsAccessKeyId,
              awsSecretAccessKey,
              catalogName: rest.catalogName,
              ...(rest.workGroup && { workGroup: rest.workGroup }),
              ...(parsedMaxResults !== undefined && { maxResults: parsedMaxResults }),
              ...(rest.nextToken && { nextToken: rest.nextToken }),
            }

          case 'list_table_metadata':
            if (!rest.catalogName) {
              throw new Error('Data catalog name is required')
            }
            if (!rest.databaseName) {
              throw new Error('Database name is required')
            }
            return {
              awsRegion,
              awsAccessKeyId,
              awsSecretAccessKey,
              catalogName: rest.catalogName,
              databaseName: rest.databaseName,
              ...(rest.expression && { expression: rest.expression }),
              ...(rest.workGroup && { workGroup: rest.workGroup }),
              ...(parsedMaxResults !== undefined && { maxResults: parsedMaxResults }),
              ...(rest.nextToken && { nextToken: rest.nextToken }),
            }

          case 'get_query_runtime_statistics':
            if (!rest.queryExecutionId) {
              throw new Error('Query execution ID is required')
            }
            return { ...connection, queryExecutionId: rest.queryExecutionId }

          case 'batch_get_named_query':
            if (!rest.namedQueryIds) {
              throw new Error('Named query IDs are required')
            }
            return { ...connection, namedQueryIds: rest.namedQueryIds }

          case 'update_named_query':
            if (!rest.namedQueryId) {
              throw new Error('Named query ID is required')
            }
            if (!rest.queryName) {
              throw new Error('Query name is required')
            }
            if (!rest.queryString) {
              throw new Error('SQL query string is required')
            }
            return {
              ...connection,
              namedQueryId: rest.namedQueryId,
              name: rest.queryName,
              queryString: rest.queryString,
              ...(rest.queryDescription && { description: rest.queryDescription }),
            }

          case 'create_prepared_statement':
          case 'update_prepared_statement':
            if (!rest.statementName) {
              throw new Error('Statement name is required')
            }
            if (!rest.workGroupName) {
              throw new Error('Workgroup is required')
            }
            if (!rest.queryString) {
              throw new Error('SQL query statement is required')
            }
            return {
              ...connection,
              statementName: rest.statementName,
              workGroup: rest.workGroupName,
              queryStatement: rest.queryString,
              ...(rest.queryDescription && { description: rest.queryDescription }),
            }

          case 'get_prepared_statement':
          case 'delete_prepared_statement':
            if (!rest.statementName) {
              throw new Error('Statement name is required')
            }
            if (!rest.workGroupName) {
              throw new Error('Workgroup is required')
            }
            return {
              ...connection,
              statementName: rest.statementName,
              workGroup: rest.workGroupName,
            }

          case 'batch_get_prepared_statement':
            if (!rest.preparedStatementNames) {
              throw new Error('Statement names are required')
            }
            if (!rest.workGroupName) {
              throw new Error('Workgroup is required')
            }
            return {
              ...connection,
              preparedStatementNames: rest.preparedStatementNames,
              workGroup: rest.workGroupName,
            }

          case 'list_prepared_statements':
            if (!rest.workGroupName) {
              throw new Error('Workgroup is required')
            }
            return {
              ...connection,
              workGroup: rest.workGroupName,
              ...(parsedMaxResults !== undefined && { maxResults: parsedMaxResults }),
              ...(rest.nextToken && { nextToken: rest.nextToken }),
            }

          case 'list_data_catalogs':
            return {
              ...connection,
              ...(rest.workGroup && { workGroup: rest.workGroup }),
              ...(parsedMaxResults !== undefined && { maxResults: parsedMaxResults }),
              ...(rest.nextToken && { nextToken: rest.nextToken }),
            }

          case 'get_data_catalog':
            if (!rest.catalogName) {
              throw new Error('Data catalog name is required')
            }
            return {
              ...connection,
              name: rest.catalogName,
              ...(rest.workGroup && { workGroup: rest.workGroup }),
            }

          case 'get_database':
            if (!rest.catalogName) {
              throw new Error('Data catalog name is required')
            }
            if (!rest.databaseName) {
              throw new Error('Database name is required')
            }
            return {
              ...connection,
              catalogName: rest.catalogName,
              databaseName: rest.databaseName,
              ...(rest.workGroup && { workGroup: rest.workGroup }),
            }

          case 'get_table_metadata':
            if (!rest.catalogName) {
              throw new Error('Data catalog name is required')
            }
            if (!rest.databaseName) {
              throw new Error('Database name is required')
            }
            if (!rest.tableName) {
              throw new Error('Table name is required')
            }
            return {
              ...connection,
              catalogName: rest.catalogName,
              databaseName: rest.databaseName,
              tableName: rest.tableName,
              ...(rest.workGroup && { workGroup: rest.workGroup }),
            }

          case 'list_work_groups':
            return {
              ...connection,
              ...(parsedMaxResults !== undefined && { maxResults: parsedMaxResults }),
              ...(rest.nextToken && { nextToken: rest.nextToken }),
            }

          case 'get_work_group':
            if (!rest.workGroupName) {
              throw new Error('Workgroup is required')
            }
            return { ...connection, workGroup: rest.workGroupName }

          default:
            throw new Error(`Invalid Athena operation: ${operation}`)
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Athena operation to perform' },
    awsRegion: { type: 'string', description: 'AWS region' },
    awsAccessKeyId: { type: 'string', description: 'AWS access key ID' },
    awsSecretAccessKey: { type: 'string', description: 'AWS secret access key' },
    queryString: { type: 'string', description: 'SQL query string' },
    database: { type: 'string', description: 'Database name' },
    catalog: { type: 'string', description: 'Data catalog name' },
    outputLocation: { type: 'string', description: 'S3 output location for results' },
    workGroup: { type: 'string', description: 'Athena workgroup name' },
    queryExecutionId: { type: 'string', description: 'Query execution ID' },
    queryExecutionIds: {
      type: 'string',
      description: 'Comma-separated query execution IDs (up to 50)',
    },
    namedQueryId: { type: 'string', description: 'Named query ID' },
    queryName: { type: 'string', description: 'Name for a saved query' },
    queryDescription: { type: 'string', description: 'Description for a saved query' },
    catalogName: { type: 'string', description: 'Data catalog name to list databases/tables from' },
    databaseName: { type: 'string', description: 'Database name to list table metadata from' },
    expression: { type: 'string', description: 'Regex filter that pattern-matches table names' },
    maxResults: { type: 'number', description: 'Maximum number of results' },
    nextToken: { type: 'string', description: 'Pagination token' },
    workGroupName: { type: 'string', description: 'Workgroup name (required by the operation)' },
    executionParameters: {
      type: 'string',
      description: 'JSON array or comma-separated values for ? placeholders in the query',
    },
    resultReuseEnabled: {
      type: 'boolean',
      description: 'Reuse a previous result of the same query',
    },
    resultReuseMaxAgeInMinutes: {
      type: 'number',
      description: 'Maximum age in minutes of a reusable result (0-10080)',
    },
    namedQueryIds: { type: 'string', description: 'Comma-separated named query IDs (up to 50)' },
    statementName: { type: 'string', description: 'Prepared statement name' },
    preparedStatementNames: {
      type: 'string',
      description: 'Comma-separated prepared statement names (up to 256)',
    },
    tableName: { type: 'string', description: 'Table name to get metadata for' },
  },
  outputs: {
    queryExecutionId: {
      type: 'string',
      description: 'Query execution ID',
    },
    query: {
      type: 'string',
      description: 'SQL query string',
    },
    state: {
      type: 'string',
      description:
        'Query state (QUEUED, RUNNING, SUCCEEDED, FAILED, CANCELLED) or workgroup state (ENABLED, DISABLED)',
    },
    stateChangeReason: {
      type: 'string',
      description: 'Reason for state change',
    },
    statementType: {
      type: 'string',
      description: 'Statement type (DDL, DML, UTILITY)',
    },
    database: {
      type: 'string',
      description: 'Database name',
    },
    catalog: {
      type: 'string',
      description: 'Data catalog name',
    },
    workGroup: {
      type: 'string',
      description: 'Workgroup name',
    },
    submissionDateTime: {
      type: 'number',
      description: 'Query submission time (Unix epoch ms)',
    },
    completionDateTime: {
      type: 'number',
      description: 'Query completion time (Unix epoch ms)',
    },
    dataScannedInBytes: {
      type: 'number',
      description: 'Data scanned in bytes',
    },
    engineExecutionTimeInMillis: {
      type: 'number',
      description: 'Engine execution time in ms',
    },
    queryPlanningTimeInMillis: {
      type: 'number',
      description: 'Query planning time in ms',
    },
    queryQueueTimeInMillis: {
      type: 'number',
      description: 'Time spent in queue in ms',
    },
    totalExecutionTimeInMillis: {
      type: 'number',
      description: 'Total execution time in ms',
    },
    outputLocation: {
      type: 'string',
      description: 'S3 location of query results',
    },
    columns: {
      type: 'array',
      description: 'Column metadata (name and type)',
    },
    rows: {
      type: 'array',
      description: 'Result rows as key-value objects',
    },
    nextToken: {
      type: 'string',
      description: 'Pagination token for next page',
    },
    updateCount: {
      type: 'number',
      description: 'Rows affected by INSERT/UPDATE',
    },
    success: {
      type: 'boolean',
      description: 'Whether the operation succeeded',
    },
    queryExecutionIds: {
      type: 'array',
      description: 'List of query execution IDs',
    },
    namedQueryId: {
      type: 'string',
      description: 'Named query ID',
    },
    name: {
      type: 'string',
      description: 'Name of the named query, database, data catalog, or workgroup',
    },
    description: {
      type: 'string',
      description: 'Description of the named query, database, data catalog, or workgroup',
    },
    queryString: {
      type: 'string',
      description: 'Named query SQL string',
    },
    namedQueryIds: {
      type: 'array',
      description: 'List of named query IDs',
    },
    queryExecutions: {
      type: 'array',
      description: 'Details for each query execution (from batch get query executions)',
    },
    unprocessedQueryExecutionIds: {
      type: 'array',
      description: 'Query execution IDs that could not be retrieved, with error details',
    },
    databases: {
      type: 'array',
      description: 'List of databases (name, description, parameters)',
    },
    rowStatistics: {
      type: 'json',
      description:
        'Query runtime row and byte counts (inputRows, inputBytes, outputRows, outputBytes)',
    },
    tables: {
      type: 'array',
      description: 'Table metadata (name, type, columns, partition keys)',
    },
    timeline: {
      type: 'json',
      description: 'Query runtime timing breakdown in milliseconds',
    },
    outputStage: {
      type: 'json',
      description: 'Summary of the final query stage',
    },
    namedQueries: {
      type: 'array',
      description: 'Details for each named query (from batch get named queries)',
    },
    unprocessedNamedQueryIds: {
      type: 'array',
      description: 'Named query IDs that could not be retrieved, with error details',
    },
    parameters: {
      type: 'json',
      description: 'Key/value properties of the database, table, or data catalog',
    },
    tableType: {
      type: 'string',
      description: 'Table type (e.g., EXTERNAL_TABLE, VIRTUAL_VIEW)',
    },
    createTime: {
      type: 'number',
      description: 'Table creation time (Unix epoch ms)',
    },
    lastAccessTime: {
      type: 'number',
      description: 'Table last access time (Unix epoch ms)',
    },
    partitionKeys: {
      type: 'array',
      description: 'Partition key columns (name, type, comment)',
    },
    dataCatalogs: {
      type: 'array',
      description: 'Data catalog summaries (name, type, status, connection type)',
    },
    type: {
      type: 'string',
      description: 'Data catalog type (LAMBDA, GLUE, HIVE, FEDERATED)',
    },
    status: {
      type: 'string',
      description: 'Data catalog creation or deletion status',
    },
    connectionType: {
      type: 'string',
      description: 'Connector type for FEDERATED data catalogs',
    },
    error: {
      type: 'string',
      description: 'Error text from data catalog creation or deletion',
    },
    workGroups: {
      type: 'array',
      description: 'Workgroup summaries (name, state, description, engine version)',
    },
    creationTime: {
      type: 'number',
      description: 'Workgroup creation time (Unix epoch ms)',
    },
    engineVersion: {
      type: 'json',
      description: 'Workgroup engine version (selected and effective)',
    },
    identityCenterApplicationArn: {
      type: 'string',
      description: 'IAM Identity Center application ARN of the workgroup',
    },
    encryptionOption: {
      type: 'string',
      description: 'Workgroup result encryption option (SSE_S3, SSE_KMS, CSE_KMS)',
    },
    kmsKey: {
      type: 'string',
      description: 'KMS key used for workgroup result encryption',
    },
    expectedBucketOwner: {
      type: 'string',
      description: 'Expected owner account of the workgroup results bucket',
    },
    managedQueryResultsEnabled: {
      type: 'boolean',
      description: 'Whether workgroup results are stored in Athena-owned storage',
    },
    enforceWorkGroupConfiguration: {
      type: 'boolean',
      description: 'Whether workgroup settings override client-side settings',
    },
    publishCloudWatchMetricsEnabled: {
      type: 'boolean',
      description: 'Whether the workgroup publishes CloudWatch metrics',
    },
    bytesScannedCutoffPerQuery: {
      type: 'number',
      description: 'Workgroup per-query data scan limit in bytes',
    },
    requesterPaysEnabled: {
      type: 'boolean',
      description: 'Whether the workgroup may query Requester Pays buckets',
    },
    enableMinimumEncryptionConfiguration: {
      type: 'boolean',
      description: 'Whether the workgroup enforces a minimum encryption level',
    },
    executionRole: {
      type: 'string',
      description: 'Workgroup execution role ARN',
    },
    statementName: {
      type: 'string',
      description: 'Prepared statement name',
    },
    queryStatement: {
      type: 'string',
      description: 'Prepared statement SQL text',
    },
    workGroupName: {
      type: 'string',
      description: 'Workgroup the prepared statement belongs to',
    },
    lastModifiedTime: {
      type: 'number',
      description: 'Prepared statement last modified time (Unix epoch ms)',
    },
    preparedStatements: {
      type: 'array',
      description: 'Prepared statement details or summaries',
    },
    unprocessedPreparedStatementNames: {
      type: 'array',
      description: 'Prepared statement names that could not be retrieved, with error details',
    },
  },
}

export const AthenaBlockMeta = {
  tags: ['cloud', 'data-analytics'],
  url: 'https://aws.amazon.com/athena',
  templates: [
    {
      icon: AthenaIcon,
      title: 'Athena scheduled report runner',
      prompt:
        'Create a scheduled workflow that runs a saved AWS Athena query daily, writes the result rows to a Sim table, and posts a Slack summary of the top movers.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['analysis', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: AthenaIcon,
      title: 'Athena S3 access audit',
      prompt:
        'Build a workflow that runs Athena queries against S3 access logs weekly, identifies unusual access patterns or new principals, and writes findings to a security audit table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'monitoring'],
      alsoIntegrations: ['s3'],
    },
    {
      icon: AthenaIcon,
      title: 'Athena cost-explorer query',
      prompt:
        'Build a scheduled workflow that runs Athena queries against AWS cost-and-usage reports daily, writes top cost movers per service to a table, and posts an anomaly digest to Slack.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'devops'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: AthenaIcon,
      title: 'Athena + Tinybird real-time bridge',
      prompt:
        'Build a workflow that combines historical Athena queries with realtime Tinybird endpoints into a unified reporting view, writes results to a dashboard table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['analysis', 'sync'],
      alsoIntegrations: ['tinybird'],
    },
    {
      icon: AthenaIcon,
      title: 'Athena + PostHog data-warehouse join',
      prompt:
        'Create a scheduled workflow that joins PostHog event exports with Athena historical data, computes funnel conversion across the join, and writes a daily report.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['product', 'analysis'],
      alsoIntegrations: ['posthog'],
    },
    {
      icon: AthenaIcon,
      title: 'Athena ad-hoc query agent',
      prompt:
        'Build a Slack agent that translates natural-language analytics questions into safe AWS Athena queries, executes them, and returns the table answer with the query for review.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['analysis', 'engineering'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: AthenaIcon,
      title: 'Athena weekly executive metrics',
      prompt:
        'Create a scheduled weekly workflow that runs a set of AWS Athena queries against the data lake for revenue, retention, and usage metrics, writes the results to a metrics table, and emails a formatted scorecard to leadership.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['reporting', 'analysis'],
      alsoIntegrations: ['gmail'],
    },
  ],
  skills: [
    {
      name: 'run-query',
      description:
        'Run a SQL query against data in S3 via Athena, wait for completion, and return the results. Use for ad-hoc analysis and reporting over your data lake.',
      content:
        '# Run Query\n\nExecute a SQL query in Athena and return the results.\n\n## Steps\n1. Compose the SQL, naming the database and confirming the output location.\n2. Start the query to obtain a query execution ID.\n3. Poll get query execution until the state is SUCCEEDED, FAILED, or CANCELLED.\n4. On success, fetch the query results and shape the rows into a clean table.\n\n## Output\nReturn the result rows plus the execution ID, data scanned, and runtime. On failure, surface the Athena error message and the SQL that caused it.',
    },
    {
      name: 'scheduled-metrics-report',
      description:
        'Run a saved or composed Athena query on a schedule to compute metrics and produce a report. Use for recurring KPI and usage reporting.',
      content:
        '# Scheduled Metrics Report\n\nCompute recurring metrics from data in S3.\n\n## Steps\n1. Use a named query, or compose the metrics SQL for the reporting period.\n2. Start the query and poll execution until it completes.\n3. Fetch the results and format the metrics for reporting.\n4. Compare against the prior period to highlight movement where relevant.\n\n## Output\nA metrics summary with current values, period-over-period change, and the execution ID for traceability.',
    },
    {
      name: 'explore-data-lake-schema',
      description:
        "Discover what data is available by listing data catalogs, databases, and tables, then reading a table's columns and partition keys before writing SQL. Use when an agent needs to ground a query in the real schema.",
      content:
        '# Explore Data Lake Schema\n\nFind the right tables and columns before querying.\n\n## Steps\n1. List data catalogs, then list databases in the relevant catalog.\n2. List table metadata in the database, filtering by a name pattern when the database is large.\n3. Get table metadata for the candidate table to read its columns, types, partition keys, and location.\n4. Use partition keys in WHERE clauses to limit the data scanned.\n\n## Output\nThe fully qualified table name, its columns with types, and the partition keys to filter on.',
    },
    {
      name: 'parameterized-query-with-prepared-statements',
      description:
        'Save a parameterized SQL statement once and run it safely with different values each time. Use for recurring reports and agent-driven lookups where inputs change but the SQL should not.',
      content:
        '# Parameterized Query with Prepared Statements\n\nRun vetted SQL with runtime values instead of string-building queries.\n\n## Steps\n1. Create a prepared statement in the workgroup with ? placeholders for each variable.\n2. Start a query with EXECUTE <statement> and pass the values as execution parameters in placeholder order.\n3. Poll get query execution until the state is SUCCEEDED, FAILED, or CANCELLED.\n4. Fetch the query results; update the prepared statement when the SQL needs to change.\n\n## Output\nThe result rows plus the statement name and execution ID used, or the Athena error if the parameters did not match the placeholders.',
    },
    {
      name: 'manage-named-queries',
      description:
        'Create, look up, and list saved (named) queries in Athena to standardize reusable SQL. Use to maintain a library of vetted analytics queries.',
      content:
        '# Manage Named Queries\n\nMaintain a library of reusable Athena queries.\n\n## Steps\n1. To save a query, create a named query with a clear name, description, database, and the SQL body.\n2. To reuse one, list named queries or get a named query by ID to retrieve its SQL.\n3. Run the retrieved SQL via start query when execution is needed.\n4. Keep names and descriptions accurate so the right query is easy to find.\n\n## Output\nReport the named query ID and name for creates, or the resolved SQL for lookups.',
    },
  ],
} as const satisfies BlockMeta
