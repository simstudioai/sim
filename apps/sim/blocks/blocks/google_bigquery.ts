import { GoogleBigQueryIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'

export const GoogleBigQueryBlock: BlockConfig = {
  type: 'google_bigquery',
  name: 'Google BigQuery',
  description: 'Query, list, and insert data in Google BigQuery',
  longDescription:
    'Connect to Google BigQuery to run SQL queries, list datasets and tables, get table metadata, and insert rows.',
  docsLink: 'https://docs.sim.ai/integrations/google_bigquery',
  category: 'tools',
  integrationType: IntegrationType.Databases,
  bgColor: '#FFFFFF',
  icon: GoogleBigQueryIcon,
  authMode: AuthMode.OAuth,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Run Query', id: 'query' },
        { label: 'Get Query Results', id: 'get_query_results' },
        { label: 'List Datasets', id: 'list_datasets' },
        { label: 'Create Dataset', id: 'create_dataset' },
        { label: 'Delete Dataset', id: 'delete_dataset' },
        { label: 'List Tables', id: 'list_tables' },
        { label: 'Get Table', id: 'get_table' },
        { label: 'Create Table', id: 'create_table' },
        { label: 'Delete Table', id: 'delete_table' },
        { label: 'List Table Data', id: 'list_table_data' },
        { label: 'Insert Rows', id: 'insert_rows' },
      ],
      value: () => 'query',
    },

    {
      id: 'credential',
      title: 'Google Account',
      type: 'oauth-input',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      required: true,
      serviceId: 'google-bigquery',
      requiredScopes: getScopesForService('google-bigquery'),
      placeholder: 'Select Google account',
    },
    {
      id: 'manualCredential',
      title: 'Google Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      required: true,
    },
    {
      id: 'projectId',
      title: 'Project ID',
      type: 'short-input',
      placeholder: 'Enter Google Cloud project ID',
      required: true,
    },

    {
      id: 'query',
      title: 'SQL Query',
      type: 'long-input',
      placeholder: 'SELECT * FROM `project.dataset.table` LIMIT 100',
      condition: { field: 'operation', value: 'query' },
      required: { field: 'operation', value: 'query' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a BigQuery Standard SQL query based on the user's description.
The query should:
- Use Standard SQL syntax (not Legacy SQL)
- Be well-formatted and efficient
- Include appropriate LIMIT clauses when applicable

Examples:
- "get all users" -> SELECT * FROM \`project.dataset.users\` LIMIT 1000
- "count orders by status" -> SELECT status, COUNT(*) as count FROM \`project.dataset.orders\` GROUP BY status
- "recent events" -> SELECT * FROM \`project.dataset.events\` ORDER BY created_at DESC LIMIT 100

Return ONLY the SQL query - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the query you want to run...',
      },
    },
    {
      id: 'useLegacySql',
      title: 'Use Legacy SQL',
      type: 'switch',
      condition: { field: 'operation', value: 'query' },
    },
    {
      id: 'maxResults',
      title: 'Max Results',
      type: 'short-input',
      placeholder: 'Maximum rows to return',
      condition: {
        field: 'operation',
        value: ['query', 'list_datasets', 'list_tables', 'list_table_data', 'get_query_results'],
      },
    },
    {
      id: 'defaultDatasetId',
      title: 'Default Dataset',
      type: 'short-input',
      placeholder: 'Default dataset for unqualified table names',
      condition: { field: 'operation', value: 'query' },
    },
    {
      id: 'location',
      title: 'Location',
      type: 'short-input',
      placeholder: 'Processing location (e.g., US, EU)',
      condition: { field: 'operation', value: ['query', 'get_query_results'] },
    },

    {
      id: 'jobId',
      title: 'Job ID',
      type: 'short-input',
      placeholder: 'Enter BigQuery job ID',
      condition: { field: 'operation', value: 'get_query_results' },
      required: { field: 'operation', value: 'get_query_results' },
    },
    {
      id: 'timeoutMs',
      title: 'Timeout (ms)',
      type: 'short-input',
      placeholder: 'How long to wait for the job to complete',
      mode: 'advanced',
      condition: { field: 'operation', value: 'get_query_results' },
    },

    {
      id: 'newDatasetId',
      title: 'Dataset ID',
      type: 'short-input',
      placeholder: 'ID for the new BigQuery dataset',
      condition: { field: 'operation', value: 'create_dataset' },
      required: { field: 'operation', value: 'create_dataset' },
    },
    {
      id: 'datasetLocation',
      title: 'Location',
      type: 'short-input',
      placeholder: 'Geographic location (e.g., US, EU)',
      condition: { field: 'operation', value: 'create_dataset' },
    },
    {
      id: 'deleteContents',
      title: 'Delete Contents',
      type: 'switch',
      condition: { field: 'operation', value: 'delete_dataset' },
    },

    {
      id: 'datasetSelector',
      title: 'Dataset',
      type: 'project-selector',
      canonicalParamId: 'datasetId',
      serviceId: 'google-bigquery',
      selectorKey: 'bigquery.datasets',
      placeholder: 'Select BigQuery dataset',
      dependsOn: ['credential', 'projectId'],
      mode: 'basic',
      condition: {
        field: 'operation',
        value: [
          'list_tables',
          'get_table',
          'insert_rows',
          'delete_dataset',
          'create_table',
          'delete_table',
          'list_table_data',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'list_tables',
          'get_table',
          'insert_rows',
          'delete_dataset',
          'create_table',
          'delete_table',
          'list_table_data',
        ],
      },
    },
    {
      id: 'datasetId',
      title: 'Dataset ID',
      type: 'short-input',
      canonicalParamId: 'datasetId',
      placeholder: 'Enter BigQuery dataset ID',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'list_tables',
          'get_table',
          'insert_rows',
          'delete_dataset',
          'create_table',
          'delete_table',
          'list_table_data',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'list_tables',
          'get_table',
          'insert_rows',
          'delete_dataset',
          'create_table',
          'delete_table',
          'list_table_data',
        ],
      },
    },

    {
      id: 'tableSelector',
      title: 'Table',
      type: 'file-selector',
      canonicalParamId: 'tableId',
      serviceId: 'google-bigquery',
      selectorKey: 'bigquery.tables',
      placeholder: 'Select BigQuery table',
      dependsOn: ['credential', 'projectId', 'datasetSelector'],
      mode: 'basic',
      condition: {
        field: 'operation',
        value: ['get_table', 'insert_rows', 'delete_table', 'list_table_data'],
      },
      required: {
        field: 'operation',
        value: ['get_table', 'insert_rows', 'delete_table', 'list_table_data'],
      },
    },
    {
      id: 'tableId',
      title: 'Table ID',
      type: 'short-input',
      canonicalParamId: 'tableId',
      placeholder: 'Enter BigQuery table ID',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['get_table', 'insert_rows', 'delete_table', 'list_table_data'],
      },
      required: {
        field: 'operation',
        value: ['get_table', 'insert_rows', 'delete_table', 'list_table_data'],
      },
    },

    {
      id: 'newTableId',
      title: 'Table ID',
      type: 'short-input',
      placeholder: 'ID for the new BigQuery table',
      condition: { field: 'operation', value: 'create_table' },
      required: { field: 'operation', value: 'create_table' },
    },
    {
      id: 'schema',
      title: 'Schema',
      type: 'long-input',
      placeholder: '[{"name": "id", "type": "STRING", "mode": "REQUIRED"}]',
      condition: { field: 'operation', value: 'create_table' },
      required: { field: 'operation', value: 'create_table' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON array of BigQuery column field definitions based on the user's description.
Each field should have "name", "type" (STRING, INTEGER, FLOAT, BOOLEAN, TIMESTAMP, DATE, RECORD, etc.), and optionally "mode" (NULLABLE, REQUIRED, REPEATED) and "description".

Examples:
- "id and name" -> [{"name": "id", "type": "STRING", "mode": "REQUIRED"}, {"name": "name", "type": "STRING"}]
- "order with amount and timestamp" -> [{"name": "order_id", "type": "STRING", "mode": "REQUIRED"}, {"name": "amount", "type": "FLOAT"}, {"name": "created_at", "type": "TIMESTAMP"}]

Return ONLY the JSON array - no explanations, no wrapping, no extra text.`,
        placeholder: 'Describe the table columns...',
        generationType: 'json-object',
      },
    },
    {
      id: 'friendlyName',
      title: 'Friendly Name',
      type: 'short-input',
      placeholder: 'Human-readable name',
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_dataset', 'create_table'] },
    },
    {
      id: 'description',
      title: 'Description',
      type: 'short-input',
      placeholder: 'Description',
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_dataset', 'create_table'] },
    },

    {
      id: 'selectedFields',
      title: 'Selected Fields',
      type: 'short-input',
      placeholder: 'Comma-separated list of column names to return',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_table_data' },
    },
    {
      id: 'startIndex',
      title: 'Start Index',
      type: 'short-input',
      placeholder: 'Zero-based index of the starting row',
      mode: 'advanced',
      condition: { field: 'operation', value: ['list_table_data', 'get_query_results'] },
    },

    {
      id: 'rows',
      title: 'Rows',
      type: 'long-input',
      placeholder: '[{"column1": "value1", "column2": 42}]',
      condition: { field: 'operation', value: 'insert_rows' },
      required: { field: 'operation', value: 'insert_rows' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON array of row objects for BigQuery insertion based on the user's description.
Each row should be a JSON object where keys are column names and values match the expected types.

Examples:
- "3 users" -> [{"name": "Alice", "email": "alice@example.com"}, {"name": "Bob", "email": "bob@example.com"}, {"name": "Charlie", "email": "charlie@example.com"}]
- "order record" -> [{"order_id": "ORD-001", "amount": 99.99, "status": "pending"}]

Return ONLY the JSON array - no explanations, no wrapping, no extra text.`,
        placeholder: 'Describe the rows to insert...',
        generationType: 'json-object',
      },
    },
    {
      id: 'skipInvalidRows',
      title: 'Skip Invalid Rows',
      type: 'switch',
      condition: { field: 'operation', value: 'insert_rows' },
    },
    {
      id: 'ignoreUnknownValues',
      title: 'Ignore Unknown Values',
      type: 'switch',
      condition: { field: 'operation', value: 'insert_rows' },
    },

    {
      id: 'pageToken',
      title: 'Page Token',
      type: 'short-input',
      placeholder: 'Pagination token',
      condition: {
        field: 'operation',
        value: ['list_datasets', 'list_tables', 'list_table_data', 'get_query_results'],
      },
    },
  ],
  tools: {
    access: [
      'google_bigquery_query',
      'google_bigquery_get_query_results',
      'google_bigquery_list_datasets',
      'google_bigquery_create_dataset',
      'google_bigquery_delete_dataset',
      'google_bigquery_list_tables',
      'google_bigquery_get_table',
      'google_bigquery_create_table',
      'google_bigquery_delete_table',
      'google_bigquery_list_table_data',
      'google_bigquery_insert_rows',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'query':
            return 'google_bigquery_query'
          case 'get_query_results':
            return 'google_bigquery_get_query_results'
          case 'list_datasets':
            return 'google_bigquery_list_datasets'
          case 'create_dataset':
            return 'google_bigquery_create_dataset'
          case 'delete_dataset':
            return 'google_bigquery_delete_dataset'
          case 'list_tables':
            return 'google_bigquery_list_tables'
          case 'get_table':
            return 'google_bigquery_get_table'
          case 'create_table':
            return 'google_bigquery_create_table'
          case 'delete_table':
            return 'google_bigquery_delete_table'
          case 'list_table_data':
            return 'google_bigquery_list_table_data'
          case 'insert_rows':
            return 'google_bigquery_insert_rows'
          default:
            throw new Error(`Invalid Google BigQuery operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const {
          oauthCredential,
          rows,
          schema,
          maxResults,
          timeoutMs,
          newDatasetId,
          newTableId,
          datasetLocation,
          location,
          ...rest
        } = params
        return {
          ...rest,
          oauthCredential,
          ...(['query', 'get_query_results'].includes(String(params.operation)) &&
            location && { location }),
          ...(params.operation === 'create_dataset' && newDatasetId && { datasetId: newDatasetId }),
          ...(params.operation === 'create_dataset' &&
            datasetLocation && { location: datasetLocation }),
          ...(params.operation === 'create_table' && newTableId && { tableId: newTableId }),
          ...(rows && { rows: typeof rows === 'string' ? rows : JSON.stringify(rows) }),
          ...(schema && { schema: typeof schema === 'string' ? schema : JSON.stringify(schema) }),
          ...(maxResults !== undefined && maxResults !== '' && { maxResults: Number(maxResults) }),
          ...(timeoutMs !== undefined && timeoutMs !== '' && { timeoutMs: Number(timeoutMs) }),
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    oauthCredential: { type: 'string', description: 'Google BigQuery OAuth credential' },
    projectId: { type: 'string', description: 'Google Cloud project ID' },
    query: { type: 'string', description: 'SQL query to execute' },
    useLegacySql: { type: 'boolean', description: 'Whether to use legacy SQL syntax' },
    maxResults: { type: 'number', description: 'Maximum number of results to return' },
    defaultDatasetId: {
      type: 'string',
      description: 'Default dataset for unqualified table names',
    },
    location: { type: 'string', description: 'Processing location' },
    jobId: { type: 'string', description: 'BigQuery job ID' },
    timeoutMs: { type: 'number', description: 'How long to wait for the job to complete' },
    newDatasetId: { type: 'string', description: 'ID for the new BigQuery dataset' },
    datasetLocation: { type: 'string', description: 'Geographic location for the new dataset' },
    deleteContents: { type: 'boolean', description: 'Whether to delete tables inside the dataset' },
    datasetId: { type: 'string', description: 'BigQuery dataset ID' },
    tableId: { type: 'string', description: 'BigQuery table ID' },
    newTableId: { type: 'string', description: 'ID for the new BigQuery table' },
    schema: { type: 'string', description: 'JSON array of column field definitions' },
    friendlyName: { type: 'string', description: 'Human-readable name' },
    description: { type: 'string', description: 'Description' },
    selectedFields: { type: 'string', description: 'Comma-separated list of column names' },
    startIndex: { type: 'string', description: 'Zero-based index of the starting row' },
    rows: { type: 'string', description: 'JSON array of row objects to insert' },
    skipInvalidRows: { type: 'boolean', description: 'Whether to skip invalid rows during insert' },
    ignoreUnknownValues: {
      type: 'boolean',
      description: 'Whether to ignore unknown column values',
    },
    pageToken: { type: 'string', description: 'Pagination token' },
  },
  outputs: {
    columns: { type: 'json', description: 'Array of column names (query)' },
    rows: { type: 'json', description: 'Array of row objects (query)' },
    totalRows: { type: 'string', description: 'Total number of rows (query)' },
    jobComplete: { type: 'boolean', description: 'Whether the query completed (query)' },
    totalBytesProcessed: { type: 'string', description: 'Bytes processed (query)' },
    cacheHit: { type: 'boolean', description: 'Whether result was cached (query)' },
    jobReference: { type: 'json', description: 'Job reference for incomplete queries (query)' },
    pageToken: {
      type: 'string',
      description: 'Token for additional result pages (query, list_table_data, get_query_results)',
    },
    datasets: { type: 'json', description: 'Array of dataset objects (list_datasets)' },
    tables: { type: 'json', description: 'Array of table objects (list_tables)' },
    totalItems: { type: 'number', description: 'Total items count (list_tables)' },
    tableId: { type: 'string', description: 'Table ID (get_table, create_table)' },
    datasetId: {
      type: 'string',
      description: 'Dataset ID (get_table, create_table, create_dataset)',
    },
    type: { type: 'string', description: 'Table type (get_table, create_table)' },
    description: {
      type: 'string',
      description: 'Table or dataset description (get_table, create_table, create_dataset)',
    },
    friendlyName: { type: 'string', description: 'Human-readable name (create_dataset)' },
    numRows: { type: 'string', description: 'Row count (get_table)' },
    numBytes: { type: 'string', description: 'Size in bytes (get_table)' },
    schema: { type: 'json', description: 'Column definitions (get_table, create_table)' },
    creationTime: {
      type: 'string',
      description: 'Creation time (get_table, create_table, create_dataset)',
    },
    lastModifiedTime: { type: 'string', description: 'Last modified time (get_table)' },
    location: {
      type: 'string',
      description: 'Data location (get_table, create_table, create_dataset)',
    },
    insertedRows: { type: 'number', description: 'Rows inserted (insert_rows)' },
    errors: { type: 'json', description: 'Insert errors (insert_rows)' },
    deleted: {
      type: 'boolean',
      description: 'Whether the resource was deleted (delete_dataset, delete_table)',
    },
    nextPageToken: { type: 'string', description: 'Token for next page of results' },
  },
}

export const GoogleBigQueryBlockMeta = {
  tags: ['data-warehouse', 'google-workspace', 'data-analytics'],
  url: 'https://cloud.google.com/bigquery',
  templates: [
    {
      icon: GoogleBigQueryIcon,
      title: 'BigQuery scheduled report runner',
      prompt:
        'Build a scheduled workflow that runs a saved BigQuery query daily, writes the result rows to a Sim table, and posts a Slack summary of the top movers.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['analysis', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GoogleBigQueryIcon,
      title: 'BigQuery customer 360 builder',
      prompt:
        'Create a scheduled workflow that joins BigQuery sources — Stripe, product events, support tickets — into a single per-customer profile table refreshed daily.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'sync'],
    },
    {
      icon: GoogleBigQueryIcon,
      title: 'BigQuery cost-tracking alerts',
      prompt:
        'Build a scheduled daily workflow that pulls BigQuery slot and storage usage, projects month-end spend, and posts a Slack alert when projection exceeds budget.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GoogleBigQueryIcon,
      title: 'BigQuery anomaly notifier',
      prompt:
        'Create a workflow that runs BigQuery anomaly-detection queries on key metrics hourly, writes any anomalies to a tracking table, and pages the on-call data team on severe deltas.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['monitoring', 'analysis'],
      alsoIntegrations: ['pagerduty'],
    },
    {
      icon: GoogleBigQueryIcon,
      title: 'BigQuery + Sheets exec dashboard',
      prompt:
        'Build a scheduled workflow that pulls a BigQuery executive dashboard query weekly, writes the result into a chosen Google Sheet, and notifies leadership the new snapshot is ready.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['reporting', 'enterprise'],
      alsoIntegrations: ['google_sheets', 'gmail'],
    },
    {
      icon: GoogleBigQueryIcon,
      title: 'BigQuery schema drift detector',
      prompt:
        'Create a scheduled workflow that snapshots BigQuery dataset schemas, diffs against the prior snapshot, and opens a Linear ticket on unexpected schema changes.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'monitoring'],
      alsoIntegrations: ['linear'],
    },
    {
      icon: GoogleBigQueryIcon,
      title: 'BigQuery NL analytics agent',
      prompt:
        "Build a Slack agent that lists BigQuery datasets and tables to understand the schema, translates a teammate's natural-language question into a safe BigQuery SQL query, runs it, and replies with the result table plus the query used.",
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['analysis', 'engineering'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'answer-question-with-sql',
      description:
        'Inspect BigQuery schema, translate a natural-language question into safe SQL, run it, and return results.',
      content:
        '# Answer Question With SQL\n\nUse BigQuery to answer a data question from plain English.\n\n## Steps\n1. List datasets and tables, and Get Table on the relevant ones to understand the schema and column types.\n2. Translate the question into a single read-only BigQuery Standard SQL query, scoping it with filters and a LIMIT to control cost.\n3. Use Run Query to execute it.\n\n## Output\nReturn the result rows as a table plus the exact SQL query used, so the answer is verifiable. If the schema cannot support the question, say what is missing.',
    },
    {
      name: 'explore-dataset-schema',
      description:
        'List BigQuery datasets and tables and summarize the schema of a dataset for an analyst.',
      content:
        '# Explore Dataset Schema\n\nUse BigQuery to map out what data is available.\n\n## Steps\n1. List datasets in the project.\n2. List tables in the target dataset.\n3. Get Table on each relevant table to read its columns, types, and descriptions.\n\n## Output\nReturn a structured schema summary: each table with its columns, types, and a one-line purpose. Highlight likely join keys so an analyst can plan queries.',
    },
    {
      name: 'load-rows-to-table',
      description: 'Insert structured rows into a BigQuery table for logging or pipeline output.',
      content:
        '# Load Rows to Table\n\nUse BigQuery to write structured records into a table.\n\n## Steps\n1. Confirm the target dataset and table, and Get Table to verify the expected columns and types.\n2. Shape the incoming records to match the table schema exactly.\n3. Use Insert Rows to write the batch.\n\n## Output\nReturn the count of rows inserted and any rows rejected with their error. If types did not match the schema, report which fields failed rather than silently dropping data.',
    },
    {
      name: 'provision-dataset-and-table',
      description:
        'Create a new BigQuery dataset and table with a defined schema for a new pipeline or logging destination.',
      content:
        '# Provision Dataset and Table\n\nUse BigQuery to set up a new destination for structured data.\n\n## Steps\n1. Use Create Dataset with a dataset ID and location.\n2. Define the column schema (name, type, mode) for the target table.\n3. Use Create Table with that schema inside the new dataset.\n\n## Output\nReturn the created dataset ID, table ID, and the resolved schema so downstream steps can insert rows with confidence the columns match.',
    },
  ],
} as const satisfies BlockMeta
