import { GoogleBigQueryIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'

export const GoogleBigQueryBlock: BlockConfig = {
  type: 'google_bigquery',
  name: 'Google BigQuery',
  description: 'Query, list, and insert data in Google BigQuery',
  longDescription:
    'Connect to Google BigQuery to run SQL queries, list datasets and tables, get table metadata, and insert rows.',
  docsLink: 'https://docs.sim.ai/tools/google_bigquery',
  category: 'tools',
  bgColor: '#E0E0E0',
  icon: GoogleBigQueryIcon,
  authMode: AuthMode.OAuth,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Run Query', id: 'query' },
        { label: 'List Datasets', id: 'list_datasets' },
        { label: 'List Tables', id: 'list_tables' },
        { label: 'Get Table', id: 'get_table' },
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
      requiredScopes: ['https://www.googleapis.com/auth/bigquery'],
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
      condition: { field: 'operation', value: ['query', 'list_datasets', 'list_tables'] },
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
      condition: { field: 'operation', value: 'query' },
    },

    {
      id: 'datasetId',
      title: 'Dataset ID',
      type: 'short-input',
      placeholder: 'Enter BigQuery dataset ID',
      condition: { field: 'operation', value: ['list_tables', 'get_table', 'insert_rows'] },
      required: { field: 'operation', value: ['list_tables', 'get_table', 'insert_rows'] },
    },

    {
      id: 'tableId',
      title: 'Table ID',
      type: 'short-input',
      placeholder: 'Enter BigQuery table ID',
      condition: { field: 'operation', value: ['get_table', 'insert_rows'] },
      required: { field: 'operation', value: ['get_table', 'insert_rows'] },
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
      condition: { field: 'operation', value: ['list_datasets', 'list_tables'] },
    },
  ],
  tools: {
    access: [
      'google_bigquery_query',
      'google_bigquery_list_datasets',
      'google_bigquery_list_tables',
      'google_bigquery_get_table',
      'google_bigquery_insert_rows',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'query':
            return 'google_bigquery_query'
          case 'list_datasets':
            return 'google_bigquery_list_datasets'
          case 'list_tables':
            return 'google_bigquery_list_tables'
          case 'get_table':
            return 'google_bigquery_get_table'
          case 'insert_rows':
            return 'google_bigquery_insert_rows'
          default:
            throw new Error(`Invalid Google BigQuery operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const { oauthCredential, rows, maxResults, ...rest } = params
        return {
          ...rest,
          oauthCredential,
          ...(rows && { rows: typeof rows === 'string' ? rows : JSON.stringify(rows) }),
          ...(maxResults !== undefined && maxResults !== '' && { maxResults: Number(maxResults) }),
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
    datasetId: { type: 'string', description: 'BigQuery dataset ID' },
    tableId: { type: 'string', description: 'BigQuery table ID' },
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
    pageToken: { type: 'string', description: 'Token for additional result pages (query)' },
    datasets: { type: 'json', description: 'Array of dataset objects (list_datasets)' },
    tables: { type: 'json', description: 'Array of table objects (list_tables)' },
    totalItems: { type: 'number', description: 'Total items count (list_tables)' },
    tableId: { type: 'string', description: 'Table ID (get_table)' },
    datasetId: { type: 'string', description: 'Dataset ID (get_table)' },
    type: { type: 'string', description: 'Table type (get_table)' },
    description: { type: 'string', description: 'Table description (get_table)' },
    numRows: { type: 'string', description: 'Row count (get_table)' },
    numBytes: { type: 'string', description: 'Size in bytes (get_table)' },
    schema: { type: 'json', description: 'Column definitions (get_table)' },
    creationTime: { type: 'string', description: 'Creation time (get_table)' },
    lastModifiedTime: { type: 'string', description: 'Last modified time (get_table)' },
    location: { type: 'string', description: 'Data location (get_table)' },
    insertedRows: { type: 'number', description: 'Rows inserted (insert_rows)' },
    errors: { type: 'json', description: 'Insert errors (insert_rows)' },
    nextPageToken: { type: 'string', description: 'Token for next page of results' },
  },
}
