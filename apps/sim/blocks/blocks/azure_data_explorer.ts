import { AzureDataExplorerIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { AzureDataExplorerTableResponse } from '@/tools/azure_data_explorer/types'

/** Every operation except the cluster-level database listing runs in a database. */
const DATABASE_SCOPED_OPERATIONS = [
  'azure_data_explorer_query',
  'azure_data_explorer_management',
  'azure_data_explorer_list_tables',
  'azure_data_explorer_show_table_schema',
  'azure_data_explorer_show_table_details',
  'azure_data_explorer_show_database_schema',
  'azure_data_explorer_list_functions',
  'azure_data_explorer_create_table',
  'azure_data_explorer_drop_table',
  'azure_data_explorer_ingest_inline',
  'azure_data_explorer_ingest_from_query',
  'azure_data_explorer_show_ingestion_failures',
  'azure_data_explorer_show_operations',
] as const

/** Operations the cluster rejects without a database in context. */
const DATABASE_REQUIRED_OPERATIONS = [
  'azure_data_explorer_query',
  'azure_data_explorer_list_tables',
  'azure_data_explorer_show_table_schema',
  'azure_data_explorer_show_table_details',
  'azure_data_explorer_show_database_schema',
  'azure_data_explorer_list_functions',
  'azure_data_explorer_create_table',
  'azure_data_explorer_drop_table',
  'azure_data_explorer_ingest_inline',
  'azure_data_explorer_ingest_from_query',
  'azure_data_explorer_show_ingestion_failures',
] as const

/** Operations that name a single table. */
const TABLE_OPERATIONS = [
  'azure_data_explorer_show_table_schema',
  'azure_data_explorer_show_table_details',
  'azure_data_explorer_create_table',
  'azure_data_explorer_drop_table',
  'azure_data_explorer_ingest_inline',
  'azure_data_explorer_ingest_from_query',
] as const

/** Table operations where the table name is mandatory. */
const TABLE_REQUIRED_OPERATIONS = [
  'azure_data_explorer_show_table_schema',
  'azure_data_explorer_create_table',
  'azure_data_explorer_drop_table',
  'azure_data_explorer_ingest_inline',
  'azure_data_explorer_ingest_from_query',
] as const

/** Operations that accept an operation ID filter. */
const OPERATION_ID_OPERATIONS = [
  'azure_data_explorer_show_ingestion_failures',
  'azure_data_explorer_show_operations',
] as const

const KQL_WAND_PROMPT = `Write a Kusto Query Language (KQL) query for Azure Data Explorer based on the user's request.

Rules:
- Start with the table name, then pipe into operators with |
- Filter with where, project columns with project, aggregate with summarize ... by
- Limit results with take or top N by <column>
- String comparison is case-sensitive with ==, case-insensitive with =~; use contains / has for substring and term matching
- Time filters use ago(), e.g. where Timestamp > ago(7d)
- String literals use double quotes

Examples:
- StormEvents | where State == "FLORIDA" | summarize count() by EventType | top 10 by count_
- Logs | where Timestamp > ago(1h) and Level == "Error" | project Timestamp, Message | take 100

Return ONLY the KQL query - no explanations, no markdown fences.`

const COLUMN_SCHEMA_WAND_PROMPT = `Write a Kusto CSL column schema for Azure Data Explorer based on the user's request.

Rules:
- Format is a comma-separated list of Name:type pairs
- Valid types are bool, datetime, decimal, dynamic, guid, int, long, real, string, and timespan
- Use datetime for timestamps, long for counts, real for measurements, dynamic for nested JSON
- Column names use letters, digits, and underscores

Examples:
- Timestamp:datetime, Level:string, Message:string, ServiceName:string
- EventTime:datetime, UserId:string, Properties:dynamic, DurationMs:long

Return ONLY the schema - no explanations, no parentheses, no markdown fences.`

/**
 * Kusto matches an ingested query result to the target table positionally, by
 * column type — never by column name — so the prompt has to make column order
 * explicit or the generated query quietly fills the wrong columns.
 */
const INGEST_QUERY_WAND_PROMPT = `${KQL_WAND_PROMPT.replace('Return ONLY the KQL query - no explanations, no markdown fences.', '')}
This query's result is ingested into an existing table. Kusto matches columns by
position and type, NOT by name, so the projected columns must come out in the
target table's column order. Use an explicit \`project\` listing the columns in
that order as the final operator.

Return ONLY the KQL query - no explanations, no markdown fences.`

/** Switch and dropdown values arrive as booleans or their string form. */
function toBoolean(value: unknown): true | undefined {
  return value === true || value === 'true' ? true : undefined
}

export const AzureDataExplorerBlock: BlockConfig<AzureDataExplorerTableResponse> = {
  type: 'azure_data_explorer',
  name: 'Azure Data Explorer',
  description: 'Query and manage Azure Data Explorer (Kusto) clusters with KQL',
  longDescription:
    'Run Kusto Query Language queries against Azure Data Explorer and Fabric Eventhouse clusters, discover databases, tables, and schemas, push small batches of rows inline, and run management commands. Authenticates with a Microsoft Entra service principal using client credentials, so no interactive sign-in is needed.',
  docsLink: 'https://docs.sim.ai/integrations/azure_data_explorer',
  category: 'tools',
  integrationType: IntegrationType.Databases,
  bgColor: '#FFFFFF',
  icon: AzureDataExplorerIcon,
  authMode: AuthMode.ApiKey,
  canvasPresentation: {
    typeLabel: 'Azure Data Explorer',
    defaultTitle: 'Azure Data Explorer',
    operationSubBlockId: 'operation',
    sentences: {
      byOperation: {
        azure_data_explorer_query: [
          { text: 'Run KQL', field: 'query', core: true },
          { text: 'against', field: 'database' },
        ],
        azure_data_explorer_management: [
          { text: 'Run', field: 'command', core: true },
          { text: 'against', field: 'database' },
        ],
        azure_data_explorer_list_databases: ['List the cluster databases'],
        azure_data_explorer_list_tables: [
          { text: 'List tables in', field: 'database', core: true },
        ],
        azure_data_explorer_show_table_schema: [
          { text: 'Read the schema of', field: 'table', core: true },
          { text: 'in', field: 'database' },
        ],
        azure_data_explorer_show_database_schema: [
          { text: 'Read the schema of', field: 'database', core: true },
        ],
        azure_data_explorer_ingest_inline: [
          { text: 'Ingest rows into', field: 'table', core: true },
          { text: 'in', field: 'database' },
        ],
        azure_data_explorer_ingest_from_query: [
          { text: 'Ingest a query result into', field: 'table', core: true },
          { text: 'from', field: 'sourceQuery' },
        ],
        azure_data_explorer_create_table: [
          { text: 'Create table', field: 'table', core: true },
          { text: 'with columns', field: 'columnSchema' },
        ],
        azure_data_explorer_drop_table: [{ text: 'Drop table', field: 'table', core: true }],
        azure_data_explorer_show_table_details: [
          'Read table details',
          { text: 'for', field: 'table' },
          { text: 'in', field: 'database' },
        ],
        azure_data_explorer_list_functions: [
          { text: 'List stored functions in', field: 'database', core: true },
        ],
        azure_data_explorer_show_ingestion_failures: [
          { text: 'List ingestion failures in', field: 'database', core: true },
        ],
        azure_data_explorer_show_operations: [
          'Check cluster operations',
          { text: 'for', field: 'operationId' },
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
        { label: 'Run Query', id: 'azure_data_explorer_query' },
        { label: 'List Databases', id: 'azure_data_explorer_list_databases' },
        { label: 'List Tables', id: 'azure_data_explorer_list_tables' },
        { label: 'Show Table Schema', id: 'azure_data_explorer_show_table_schema' },
        { label: 'Show Database Schema', id: 'azure_data_explorer_show_database_schema' },
        { label: 'Show Table Details', id: 'azure_data_explorer_show_table_details' },
        { label: 'List Functions', id: 'azure_data_explorer_list_functions' },
        { label: 'Ingest Rows Inline', id: 'azure_data_explorer_ingest_inline' },
        { label: 'Ingest From Query', id: 'azure_data_explorer_ingest_from_query' },
        { label: 'Create Table', id: 'azure_data_explorer_create_table' },
        { label: 'Drop Table', id: 'azure_data_explorer_drop_table' },
        { label: 'Show Ingestion Failures', id: 'azure_data_explorer_show_ingestion_failures' },
        { label: 'Show Operations', id: 'azure_data_explorer_show_operations' },
        { label: 'Management Command (advanced)', id: 'azure_data_explorer_management' },
      ],
      value: () => 'azure_data_explorer_query',
      required: true,
    },

    {
      id: 'database',
      title: 'Database',
      type: 'short-input',
      placeholder: 'Samples',
      condition: { field: 'operation', value: [...DATABASE_SCOPED_OPERATIONS] },
      required: { field: 'operation', value: [...DATABASE_REQUIRED_OPERATIONS] },
    },
    {
      id: 'query',
      title: 'KQL Query',
      type: 'long-input',
      placeholder: 'StormEvents | where State == "FLORIDA" | summarize count() by EventType',
      condition: { field: 'operation', value: 'azure_data_explorer_query' },
      required: { field: 'operation', value: 'azure_data_explorer_query' },
      wandConfig: {
        enabled: true,
        prompt: KQL_WAND_PROMPT,
        placeholder:
          'Describe the query you want (e.g., "error count per service in the last day")',
      },
    },
    {
      id: 'readOnly',
      title: 'Read-only',
      type: 'switch',
      description: 'Reject any request that would change data (sends x-ms-readonly)',
      condition: { field: 'operation', value: 'azure_data_explorer_query' },
      mode: 'advanced',
    },
    {
      id: 'properties',
      title: 'Request Properties',
      type: 'long-input',
      placeholder: '{"Options":{"servertimeout":"00:04:00"}}',
      condition: { field: 'operation', value: 'azure_data_explorer_query' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a Kusto request properties JSON object. The shape is {"Options":{...},"Parameters":{...}}. Common options are servertimeout (a timespan like "00:04:00"), queryconsistency ("strongconsistency" or "weakconsistency"), and truncationmaxrecords. Return ONLY the JSON object.',
        generationType: 'json-object',
        placeholder: 'Describe the request options you need',
      },
    },

    {
      id: 'table',
      title: 'Table',
      type: 'short-input',
      placeholder: 'StormEvents',
      condition: { field: 'operation', value: [...TABLE_OPERATIONS] },
      required: { field: 'operation', value: [...TABLE_REQUIRED_OPERATIONS] },
    },
    {
      id: 'data',
      title: 'Rows',
      type: 'long-input',
      placeholder: 'Shoes,1000\nWide Shoes,50',
      condition: { field: 'operation', value: 'azure_data_explorer_ingest_inline' },
      required: { field: 'operation', value: 'azure_data_explorer_ingest_inline' },
    },
    {
      id: 'columnSchema',
      title: 'Column Schema',
      type: 'long-input',
      placeholder: 'Timestamp:datetime, Level:string, Message:string, Count:long',
      condition: { field: 'operation', value: 'azure_data_explorer_create_table' },
      required: { field: 'operation', value: 'azure_data_explorer_create_table' },
      wandConfig: {
        enabled: true,
        prompt: COLUMN_SCHEMA_WAND_PROMPT,
        placeholder:
          'Describe the columns you want (e.g., "error logs with a timestamp and service")',
      },
    },
    {
      id: 'tableProperties',
      title: 'Table Properties',
      type: 'short-input',
      placeholder: 'docstring="Raw application logs", folder="Ingest"',
      condition: { field: 'operation', value: 'azure_data_explorer_create_table' },
      mode: 'advanced',
    },
    {
      id: 'ifExists',
      title: 'Ignore missing table',
      type: 'switch',
      description: 'Succeed instead of failing when the table does not exist',
      condition: { field: 'operation', value: 'azure_data_explorer_drop_table' },
      mode: 'advanced',
    },
    {
      id: 'ingestMode',
      title: 'Mode',
      type: 'dropdown',
      options: [
        { label: 'Set or append — create, or add to an existing table', id: 'set-or-append' },
        { label: 'Set — create, fail if the table exists', id: 'set' },
        { label: 'Append — add to an existing table', id: 'append' },
        { label: 'Set or replace — replace all data in the table', id: 'set-or-replace' },
      ],
      value: () => 'set-or-append',
      condition: { field: 'operation', value: 'azure_data_explorer_ingest_from_query' },
      required: { field: 'operation', value: 'azure_data_explorer_ingest_from_query' },
    },
    {
      id: 'sourceQuery',
      title: 'Source Query',
      type: 'long-input',
      placeholder: 'LogsTable | where Level == "Error" and Timestamp > ago(1h)',
      condition: { field: 'operation', value: 'azure_data_explorer_ingest_from_query' },
      required: { field: 'operation', value: 'azure_data_explorer_ingest_from_query' },
      wandConfig: {
        enabled: true,
        prompt: INGEST_QUERY_WAND_PROMPT,
        placeholder: 'Describe the rows you want to materialize into the table',
      },
    },
    {
      id: 'ingestAsync',
      title: 'Run in background',
      type: 'switch',
      description:
        'Return an operation ID immediately and keep ingesting — check it with Show Operations',
      condition: { field: 'operation', value: 'azure_data_explorer_ingest_from_query' },
      mode: 'advanced',
    },
    {
      id: 'operationId',
      title: 'Operation ID',
      type: 'short-input',
      placeholder: 'Operation ID returned by an async ingestion',
      condition: { field: 'operation', value: [...OPERATION_ID_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'ingestionProperties',
      title: 'Ingestion Properties',
      type: 'short-input',
      placeholder: 'format="json", ingestionMappingReference="mymapping"',
      condition: {
        field: 'operation',
        value: ['azure_data_explorer_ingest_inline', 'azure_data_explorer_ingest_from_query'],
      },
      mode: 'advanced',
    },

    {
      id: 'command',
      title: 'Management Command',
      type: 'long-input',
      placeholder: '.show table StormEvents details',
      condition: { field: 'operation', value: 'azure_data_explorer_management' },
      required: { field: 'operation', value: 'azure_data_explorer_management' },
      wandConfig: {
        enabled: true,
        prompt:
          'Write a single Azure Data Explorer management command for the user\'s request. Management commands start with a dot, e.g. ".show tables details", ".create table Events (Timestamp:datetime, Message:string)", ".alter-merge table Events policy retention softdelete = 30d". Return ONLY the command text.',
        placeholder: 'Describe the management command you want',
      },
    },

    {
      id: 'clusterUri',
      title: 'Cluster URI',
      type: 'short-input',
      placeholder: 'https://mycluster.eastus.kusto.windows.net',
      required: true,
    },
    {
      id: 'tenantId',
      title: 'Tenant ID',
      type: 'short-input',
      placeholder: 'Microsoft Entra directory (tenant) ID',
      required: true,
    },
    {
      id: 'clientId',
      title: 'Client ID',
      type: 'short-input',
      placeholder: 'Application (client) ID of the service principal',
      password: true,
      required: true,
    },
    {
      id: 'clientSecret',
      title: 'Client Secret',
      type: 'short-input',
      placeholder: 'Client secret of the service principal',
      password: true,
      required: true,
    },
    {
      id: 'resource',
      title: 'Token Audience',
      type: 'short-input',
      placeholder: 'Defaults to the cluster URI',
      mode: 'advanced',
    },
  ],
  tools: {
    access: [
      'azure_data_explorer_query',
      'azure_data_explorer_management',
      'azure_data_explorer_list_databases',
      'azure_data_explorer_list_tables',
      'azure_data_explorer_show_table_schema',
      'azure_data_explorer_show_database_schema',
      'azure_data_explorer_show_table_details',
      'azure_data_explorer_list_functions',
      'azure_data_explorer_ingest_inline',
      'azure_data_explorer_ingest_from_query',
      'azure_data_explorer_create_table',
      'azure_data_explorer_drop_table',
      'azure_data_explorer_show_ingestion_failures',
      'azure_data_explorer_show_operations',
    ],
    config: {
      tool: (params) => params.operation,
      params: (params) => {
        const auth = {
          clusterUri: params.clusterUri,
          tenantId: params.tenantId,
          clientId: params.clientId,
          clientSecret: params.clientSecret,
          resource: params.resource || undefined,
        }

        switch (params.operation) {
          case 'azure_data_explorer_query':
            return {
              ...auth,
              database: params.database,
              query: params.query,
              properties: params.properties || undefined,
              readOnly: toBoolean(params.readOnly),
            }
          case 'azure_data_explorer_management':
            return {
              ...auth,
              database: params.database || undefined,
              command: params.command,
            }
          case 'azure_data_explorer_list_databases':
            return auth
          case 'azure_data_explorer_list_tables':
          case 'azure_data_explorer_show_database_schema':
            return { ...auth, database: params.database }
          case 'azure_data_explorer_show_table_schema':
            return { ...auth, database: params.database, table: params.table }
          case 'azure_data_explorer_ingest_inline':
            return {
              ...auth,
              database: params.database,
              table: params.table,
              data: params.data,
              ingestionProperties: params.ingestionProperties || undefined,
            }
          case 'azure_data_explorer_ingest_from_query':
            return {
              ...auth,
              database: params.database,
              table: params.table,
              mode: params.ingestMode || undefined,
              sourceQuery: params.sourceQuery,
              async: toBoolean(params.ingestAsync),
              ingestionProperties: params.ingestionProperties || undefined,
            }
          case 'azure_data_explorer_create_table':
            return {
              ...auth,
              database: params.database,
              table: params.table,
              columnSchema: params.columnSchema,
              tableProperties: params.tableProperties || undefined,
            }
          case 'azure_data_explorer_drop_table':
            return {
              ...auth,
              database: params.database,
              table: params.table,
              ifExists: toBoolean(params.ifExists),
            }
          case 'azure_data_explorer_show_table_details':
            return { ...auth, database: params.database, table: params.table || undefined }
          case 'azure_data_explorer_list_functions':
            return { ...auth, database: params.database }
          case 'azure_data_explorer_show_ingestion_failures':
            return {
              ...auth,
              database: params.database,
              operationId: params.operationId || undefined,
            }
          case 'azure_data_explorer_show_operations':
            return {
              ...auth,
              database: params.database || undefined,
              operationId: params.operationId || undefined,
            }
          default:
            return auth
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to run' },
    clusterUri: { type: 'string', description: 'Azure Data Explorer cluster URI' },
    tenantId: { type: 'string', description: 'Microsoft Entra tenant ID' },
    clientId: { type: 'string', description: 'Microsoft Entra application (client) ID' },
    clientSecret: { type: 'string', description: 'Microsoft Entra client secret' },
    resource: { type: 'string', description: 'Token audience override' },
    database: { type: 'string', description: 'Database context for the request' },
    query: { type: 'string', description: 'KQL query text' },
    properties: { type: 'json', description: 'Kusto request properties object' },
    readOnly: { type: 'boolean', description: 'Reject any request that would change data' },
    command: { type: 'string', description: 'Management command text' },
    table: { type: 'string', description: 'Target table name' },
    data: { type: 'string', description: 'Rows to ingest, one record per line' },
    ingestionProperties: { type: 'string', description: 'Ingestion properties clause contents' },
    columnSchema: { type: 'string', description: 'CSL column schema for a new table' },
    tableProperties: { type: 'string', description: 'Table properties clause contents' },
    ifExists: { type: 'boolean', description: 'Ignore a missing table when dropping' },
    ingestMode: { type: 'string', description: 'set | append | set-or-append | set-or-replace' },
    sourceQuery: { type: 'string', description: 'KQL query whose result is ingested' },
    ingestAsync: { type: 'boolean', description: 'Ingest in the background' },
    operationId: { type: 'string', description: 'Operation ID to look up' },
  },
  outputs: {
    tableName: { type: 'string', description: 'Name Kusto assigned to the result table' },
    columns: { type: 'json', description: 'Column metadata for the result table' },
    rows: { type: 'json', description: 'Result rows as positional arrays' },
    records: { type: 'json', description: 'Result rows keyed by column name' },
    rowCount: { type: 'number', description: 'Rows carried in this result, after the row cap' },
    totalRowCount: { type: 'number', description: 'Rows Kusto returned, before the row cap' },
    truncated: { type: 'boolean', description: 'Whether rows were dropped to stay within the cap' },
    databases: { type: 'json', description: 'Database names (List Databases)' },
    tables: { type: 'json', description: 'Table names (List Tables)' },
    extentIds: { type: 'json', description: 'Extent IDs created (Ingest Rows Inline)' },
    schema: { type: 'string', description: 'CSL column schema (Show Table Schema)' },
    databaseName: { type: 'string', description: "Table's database (Show Table Schema)" },
    folder: { type: 'string', description: "Table's folder (Show Table Schema)" },
    docString: { type: 'string', description: "Table's docstring (Show Table Schema)" },
    functions: { type: 'json', description: 'Stored function names (List Functions)' },
  },
}

export const AzureDataExplorerBlockMeta = {
  tags: ['data-analytics', 'data-warehouse', 'cloud', 'monitoring'],
  url: 'https://azure.microsoft.com/products/data-explorer',
  templates: [
    {
      icon: AzureDataExplorerIcon,
      title: 'Ask questions of Kusto data',
      prompt:
        'Build an agent that turns plain-English questions about our telemetry into KQL, reads the Azure Data Explorer table schema first so the columns are real, runs the query, and answers with the numbers plus the query it used.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['analytics', 'automation'],
    },
    {
      icon: AzureDataExplorerIcon,
      title: 'Daily telemetry digest',
      prompt:
        'Create a scheduled workflow that queries Azure Data Explorer every morning for yesterday error rates, latency percentiles, and traffic by service, summarizes what moved against the prior week, and posts the digest to our engineering Slack channel.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['analytics', 'monitoring', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: AzureDataExplorerIcon,
      title: 'Kusto anomaly alerts',
      prompt:
        'Build a workflow that runs every 15 minutes, queries Azure Data Explorer for request failures grouped by endpoint, compares each endpoint against its own trailing baseline, and pages the on-call engineer through PagerDuty only when a real spike appears.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['monitoring', 'incident-response', 'automation'],
      alsoIntegrations: ['pagerduty'],
    },
    {
      icon: AzureDataExplorerIcon,
      title: 'Incident timeline from telemetry',
      prompt:
        'Create a workflow that takes an incident window and service name, pulls the matching logs, traces, and deploy events out of Azure Data Explorer, and writes an ordered timeline file that an engineer can drop straight into a postmortem.',
      modules: ['agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['monitoring', 'incident-response', 'reporting'],
    },
    {
      icon: AzureDataExplorerIcon,
      title: 'Event pipeline into Kusto',
      prompt:
        'Build a workflow triggered by a webhook that validates each incoming event payload, maps it onto our Azure Data Explorer table schema, ingests the rows inline, and records any rejected payloads in a table so nothing is lost silently.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['automation', 'data-pipeline'],
    },
    {
      icon: AzureDataExplorerIcon,
      title: 'Kusto cluster inventory',
      prompt:
        'Create a scheduled workflow that lists every Azure Data Explorer database and table, reads their schemas, and keeps a Sim table up to date as a searchable data-model catalog with a note on what changed since the last run.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['analytics', 'documentation', 'automation'],
    },
    {
      icon: AzureDataExplorerIcon,
      title: 'Usage report to stakeholders',
      prompt:
        'Build a scheduled weekly workflow that queries Azure Data Explorer for product usage by account and feature, ranks the biggest movers, generates a report file with the supporting numbers, and emails it to the account team.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['analytics', 'reporting', 'automation'],
    },
  ],
  skills: [
    {
      name: 'explore-kusto-schema',
      description:
        'Discover what data an Azure Data Explorer cluster holds before writing a query against it.',
      content:
        '# Explore Kusto Schema\n\nMap out a cluster before querying it, so queries reference columns that actually exist.\n\n## Steps\n1. Run List Databases to see what the service principal can reach.\n2. Run List Tables on the database that looks relevant.\n3. Run Show Table Schema on each candidate table to read its columns and types, or Show Database Schema to pull every table and column in one call.\n\n## Output\nReturn the database name, the tables that matter for the question at hand, and each relevant column with its type.',
    },
    {
      name: 'answer-with-kql',
      description: 'Answer a data question by writing and running a KQL query, then explaining it.',
      content:
        '# Answer With KQL\n\nTurn a question about the data into a query and a trustworthy answer.\n\n## Steps\n1. Run Show Table Schema on the table involved so column names and types are known rather than guessed.\n2. Write the KQL: filter with `where`, aggregate with `summarize ... by`, bound the result with `take` or `top N by`.\n3. Run Query with the read-only option enabled so the request cannot change data.\n4. If the result looks wrong or empty, widen the time filter or relax the string comparison and try again.\n\n## Output\nReport the answer, the row count, and the exact KQL that produced it so the result can be re-run and checked.',
    },
    {
      name: 'materialize-a-rollup-table',
      description:
        'Build or refresh a summary table in Azure Data Explorer from a query over raw data.',
      content:
        '# Materialize A Rollup Table\n\nTurn an expensive query over raw telemetry into a small table that is cheap to read.\n\n## Steps\n1. Run Show Table Details on the source table to see how much data the query will scan.\n2. Run Show Table Schema on the **target** table. Kusto matches an ingested query result to the table by column position and type, never by name, so you need its exact column order before writing the query.\n3. Write the aggregating KQL — `summarize` the raw rows into the shape you want, bucketing time with `bin()` where relevant — and end it with an explicit `project` listing the columns in the target table order.\n4. Run Ingest From Query against the target table. Use `set-or-append` to add the new window to an existing rollup, `set-or-replace` to rebuild it from scratch, and `set` only for the first run.\n5. For a large backfill, enable the background option and poll Show Operations with the returned operation ID until the state is Completed.\n6. Run Query against the rollup and spot-check a few rows to confirm each column holds what it should, not just that the row count is plausible.\n\n## Output\nReport the target table, the mode used, the rows or extents produced, and the verification query result. Call out that `set-or-replace` discards the existing data in the table, and that a mismatched column order corrupts data silently rather than failing.',
    },
    {
      name: 'debug-ingestion-failures',
      description:
        'Diagnose why data is missing from an Azure Data Explorer table and say whether it will retry.',
      content:
        '# Debug Ingestion Failures\n\nFind out why expected rows never arrived.\n\n## Steps\n1. Run Show Ingestion Failures for the database. Failures are kept for 14 days, so anything older will not appear.\n2. Group what comes back by table, error code, and failure kind. `Permanent` failures will not retry on their own; `Transient` ones may already have succeeded on a later attempt.\n3. Read the failure detail for the root cause — schema mismatch, a malformed source file, or a missing ingestion mapping are the usual ones.\n4. Run Show Table Schema on the target table and compare it against the source data shape named in the failure.\n5. Take the operation ID from a failure and run Show Operations on it for the fuller history of that operation.\n\n## Output\nReport the affected tables, the distinct error codes with counts, the likely root cause, and whether each failure is permanent (needs a fix) or transient (may self-resolve). Confirm with a Query against the table whether the rows are genuinely absent.',
    },
    {
      name: 'ingest-rows-into-kusto',
      description: 'Push a small batch of records into an Azure Data Explorer table.',
      content:
        '# Ingest Rows Into Kusto\n\nLoad a handful of records into a table without setting up a pipeline.\n\n## Steps\n1. Run Show Table Schema on the target table to learn the column order and types.\n2. Format the records as CSV in that exact column order, one record per line, quoting any value containing a comma.\n3. Run Ingest Rows Inline against the table.\n4. Run Query to read the newly ingested rows back and confirm they landed as intended.\n\n## Output\nReport how many rows were sent, the extent IDs returned, and the verification query result. Note that inline ingestion is for small batches — recommend queued or streaming ingestion for ongoing volume.',
    },
  ],
} as const satisfies BlockMeta
