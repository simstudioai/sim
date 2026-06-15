import { AthenaIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { IntegrationType } from '@/blocks/types'
import type {
  AthenaCreateNamedQueryResponse,
  AthenaGetNamedQueryResponse,
  AthenaGetQueryExecutionResponse,
  AthenaGetQueryResultsResponse,
  AthenaListNamedQueriesResponse,
  AthenaListQueryExecutionsResponse,
  AthenaStartQueryResponse,
  AthenaStopQueryResponse,
} from '@/tools/athena/types'

export const AthenaBlock: BlockConfig<
  | AthenaStartQueryResponse
  | AthenaGetQueryExecutionResponse
  | AthenaGetQueryResultsResponse
  | AthenaStopQueryResponse
  | AthenaListQueryExecutionsResponse
  | AthenaCreateNamedQueryResponse
  | AthenaGetNamedQueryResponse
  | AthenaListNamedQueriesResponse
> = {
  type: 'athena',
  name: 'Athena',
  description: 'Run SQL queries on data in Amazon S3 using AWS Athena',
  longDescription:
    'Integrate AWS Athena into workflows. Execute SQL queries against data in S3, check query status, retrieve results, manage named queries, and list executions. Requires AWS access key and secret access key.',
  docsLink: 'https://docs.sim.ai/integrations/athena',
  category: 'tools',
  integrationType: IntegrationType.Analytics,
  bgColor: 'linear-gradient(45deg, #4D27A8 0%, #A166FF 100%)',
  iconColor: '#A166FF',
  icon: AthenaIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Start Query', id: 'start_query' },
        { label: 'Get Query Execution', id: 'get_query_execution' },
        { label: 'Get Query Results', id: 'get_query_results' },
        { label: 'Stop Query', id: 'stop_query' },
        { label: 'List Query Executions', id: 'list_query_executions' },
        { label: 'Create Named Query', id: 'create_named_query' },
        { label: 'Get Named Query', id: 'get_named_query' },
        { label: 'List Named Queries', id: 'list_named_queries' },
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
      condition: { field: 'operation', value: ['start_query', 'create_named_query'] },
      required: { field: 'operation', value: ['start_query', 'create_named_query'] },
      wandConfig: {
        enabled: true,
        prompt: `Generate an SQL query for AWS Athena based on the user's description.
Athena uses Trino/Presto SQL syntax. Common patterns:
- SELECT * FROM "database"."table" LIMIT 10
- SELECT column1, COUNT(*) FROM table GROUP BY column1
- SELECT * FROM table WHERE date_column > DATE '2024-01-01'
- CREATE TABLE new_table AS SELECT ... FROM source_table
- SELECT * FROM table WHERE column IN ('value1', 'value2')

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
        value: ['start_query', 'list_query_executions', 'create_named_query', 'list_named_queries'],
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
        value: ['get_query_execution', 'get_query_results', 'stop_query'],
      },
      required: {
        field: 'operation',
        value: ['get_query_execution', 'get_query_results', 'stop_query'],
      },
    },
    {
      id: 'namedQueryId',
      title: 'Named Query ID',
      type: 'short-input',
      placeholder: 'e.g., a1b2c3d4-5678-90ab-cdef-example11111',
      condition: { field: 'operation', value: 'get_named_query' },
      required: { field: 'operation', value: 'get_named_query' },
    },
    {
      id: 'queryName',
      title: 'Query Name',
      type: 'short-input',
      placeholder: 'My Saved Query',
      condition: { field: 'operation', value: 'create_named_query' },
      required: { field: 'operation', value: 'create_named_query' },
    },
    {
      id: 'queryDescription',
      title: 'Description',
      type: 'short-input',
      placeholder: 'Description of what this query does',
      condition: { field: 'operation', value: 'create_named_query' },
      mode: 'advanced',
    },
    {
      id: 'maxResults',
      title: 'Max Results',
      type: 'short-input',
      placeholder: '50',
      condition: {
        field: 'operation',
        value: ['get_query_results', 'list_query_executions', 'list_named_queries'],
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
        value: ['get_query_results', 'list_query_executions', 'list_named_queries'],
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
      'athena_create_named_query',
      'athena_get_named_query',
      'athena_list_named_queries',
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
          case 'create_named_query':
            return 'athena_create_named_query'
          case 'get_named_query':
            return 'athena_get_named_query'
          case 'list_named_queries':
            return 'athena_list_named_queries'
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
    namedQueryId: { type: 'string', description: 'Named query ID' },
    queryName: { type: 'string', description: 'Name for a saved query' },
    queryDescription: { type: 'string', description: 'Description for a saved query' },
    maxResults: { type: 'number', description: 'Maximum number of results' },
    nextToken: { type: 'string', description: 'Pagination token' },
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
      description: 'Query state (QUEUED, RUNNING, SUCCEEDED, FAILED, CANCELLED)',
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
      description: 'Named query name',
    },
    description: {
      type: 'string',
      description: 'Named query description',
    },
    queryString: {
      type: 'string',
      description: 'Named query SQL string',
    },
    namedQueryIds: {
      type: 'array',
      description: 'List of named query IDs',
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
      name: 'manage-named-queries',
      description:
        'Create, look up, and list saved (named) queries in Athena to standardize reusable SQL. Use to maintain a library of vetted analytics queries.',
      content:
        '# Manage Named Queries\n\nMaintain a library of reusable Athena queries.\n\n## Steps\n1. To save a query, create a named query with a clear name, description, database, and the SQL body.\n2. To reuse one, list named queries or get a named query by ID to retrieve its SQL.\n3. Run the retrieved SQL via start query when execution is needed.\n4. Keep names and descriptions accurate so the right query is easy to find.\n\n## Output\nReport the named query ID and name for creates, or the resolved SQL for lookups.',
    },
  ],
} as const satisfies BlockMeta
