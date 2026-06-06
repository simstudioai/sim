import { TinybirdIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { TinybirdResponse } from '@/tools/tinybird/types'

export const TinybirdBlock: BlockConfig<TinybirdResponse> = {
  type: 'tinybird',
  name: 'Tinybird',
  description: 'Send events, query data, and manage Data Sources with Tinybird',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Interact with Tinybird: stream JSON or NDJSON events with the Events API, run SQL with the Query API, call published Pipe API Endpoints by name with dynamic parameters, and manage Data Sources by appending from a URL, truncating, or deleting rows by condition.',
  docsLink: 'https://docs.sim.ai/tools/tinybird',
  category: 'tools',
  integrationType: IntegrationType.Analytics,
  tags: ['data-warehouse', 'data-analytics'],
  bgColor: '#2EF598',
  icon: TinybirdIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Send Events', id: 'tinybird_events' },
        { label: 'Query', id: 'tinybird_query' },
        { label: 'Query Pipe Endpoint', id: 'tinybird_query_pipe' },
        { label: 'Append Data Source (from URL)', id: 'tinybird_append_datasource' },
        { label: 'Truncate Data Source', id: 'tinybird_truncate_datasource' },
        { label: 'Delete Data Source Rows', id: 'tinybird_delete_datasource_rows' },
      ],
      value: () => 'tinybird_events',
    },
    {
      id: 'base_url',
      title: 'Base URL',
      type: 'short-input',
      placeholder: 'https://api.tinybird.co',
      required: true,
    },
    {
      id: 'token',
      title: 'API Token',
      type: 'short-input',
      placeholder: 'Enter your Tinybird API token',
      password: true,
      required: true,
    },
    // Data Source name (Send Events + Data Source management operations)
    {
      id: 'datasource',
      title: 'Data Source',
      type: 'short-input',
      placeholder: 'my_events_datasource',
      condition: {
        field: 'operation',
        value: [
          'tinybird_events',
          'tinybird_append_datasource',
          'tinybird_truncate_datasource',
          'tinybird_delete_datasource_rows',
        ],
      },
      required: true,
    },
    {
      id: 'data',
      title: 'Data',
      type: 'code',
      placeholder:
        '{"event": "click", "timestamp": "2024-01-01T12:00:00Z"}\n{"event": "view", "timestamp": "2024-01-01T12:00:01Z"}',
      condition: { field: 'operation', value: 'tinybird_events' },
      required: true,
    },
    {
      id: 'format',
      title: 'Format',
      type: 'dropdown',
      options: [
        { label: 'NDJSON (Newline-delimited JSON)', id: 'ndjson' },
        { label: 'JSON', id: 'json' },
      ],
      value: () => 'ndjson',
      condition: { field: 'operation', value: 'tinybird_events' },
    },
    {
      id: 'compression',
      title: 'Compression',
      type: 'dropdown',
      options: [
        { label: 'None', id: 'none' },
        { label: 'Gzip', id: 'gzip' },
      ],
      value: () => 'none',
      mode: 'advanced',
      condition: { field: 'operation', value: 'tinybird_events' },
    },
    {
      id: 'wait',
      title: 'Wait for Acknowledgment',
      type: 'switch',
      value: () => 'false',
      mode: 'advanced',
      condition: { field: 'operation', value: 'tinybird_events' },
    },
    // Query operation inputs
    {
      id: 'query',
      title: 'SQL Query',
      type: 'code',
      placeholder: 'SELECT * FROM my_pipe FORMAT JSON\nOR\nSELECT * FROM my_pipe FORMAT CSV',
      condition: { field: 'operation', value: 'tinybird_query' },
      required: true,
    },
    {
      id: 'pipeline',
      title: 'Pipeline Name',
      type: 'short-input',
      placeholder: 'my_pipe (optional)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'tinybird_query' },
    },
    // Query Pipe Endpoint operation inputs
    {
      id: 'pipe',
      title: 'Pipe Name',
      type: 'short-input',
      placeholder: 'top_pages',
      condition: { field: 'operation', value: 'tinybird_query_pipe' },
      required: true,
    },
    {
      id: 'parameters',
      title: 'Parameters',
      type: 'code',
      placeholder: '{\n  "start_date": "2024-01-01",\n  "limit": 10\n}',
      condition: { field: 'operation', value: 'tinybird_query_pipe' },
      wandConfig: {
        enabled: true,
        generationType: 'json-object',
        placeholder: 'Describe the Pipe parameters to pass',
        prompt:
          'Generate a JSON object of dynamic parameters to pass to a Tinybird Pipe API Endpoint. Keys are parameter names and values are their values. Return ONLY the JSON object - no explanations, no extra text.',
      },
    },
    {
      id: 'pipe_sql',
      title: 'SQL (on top of Pipe)',
      type: 'code',
      placeholder: 'SELECT count() FROM _',
      mode: 'advanced',
      condition: { field: 'operation', value: 'tinybird_query_pipe' },
    },
    // Append Data Source operation inputs
    {
      id: 'source_url',
      title: 'Source File URL',
      type: 'short-input',
      placeholder: 'https://example.com/data.csv',
      condition: { field: 'operation', value: 'tinybird_append_datasource' },
      required: true,
    },
    {
      id: 'source_format',
      title: 'Source Format',
      type: 'dropdown',
      options: [
        { label: 'CSV', id: 'csv' },
        { label: 'NDJSON', id: 'ndjson' },
        { label: 'Parquet', id: 'parquet' },
      ],
      value: () => 'csv',
      condition: { field: 'operation', value: 'tinybird_append_datasource' },
    },
    // Delete Data Source Rows operation inputs
    {
      id: 'delete_condition',
      title: 'Delete Condition',
      type: 'long-input',
      placeholder: "country = 'ES'",
      condition: { field: 'operation', value: 'tinybird_delete_datasource_rows' },
      required: true,
      wandConfig: {
        enabled: true,
        generationType: 'sql-query',
        placeholder: 'Describe which rows to delete',
        prompt:
          'Generate a SQL WHERE-clause condition (without the WHERE keyword) selecting rows to delete from a table. Example: "event_date < \'2024-01-01\'". Return ONLY the SQL condition - no explanations, no extra text.',
      },
    },
    {
      id: 'dry_run',
      title: 'Dry Run',
      type: 'switch',
      value: () => 'false',
      mode: 'advanced',
      condition: { field: 'operation', value: 'tinybird_delete_datasource_rows' },
    },
  ],
  tools: {
    access: [
      'tinybird_events',
      'tinybird_query',
      'tinybird_query_pipe',
      'tinybird_append_datasource',
      'tinybird_truncate_datasource',
      'tinybird_delete_datasource_rows',
    ],
    config: {
      tool: (params) => params.operation || 'tinybird_events',
      params: (params) => {
        const operation = params.operation || 'tinybird_events'
        const result: Record<string, any> = {
          base_url: params.base_url,
          token: params.token,
        }

        if (operation === 'tinybird_events') {
          // Send Events operation
          if (!params.datasource) {
            throw new Error('Data Source is required for Send Events operation')
          }
          if (!params.data) {
            throw new Error('Data is required for Send Events operation')
          }

          result.datasource = params.datasource
          result.data = params.data
          result.format = params.format || 'ndjson'
          result.compression = params.compression || 'none'

          // Convert wait from string to boolean
          if (params.wait !== undefined) {
            const waitValue =
              typeof params.wait === 'string' ? params.wait.toLowerCase() : params.wait
            result.wait = waitValue === 'true' || waitValue === true
          }
        } else if (operation === 'tinybird_query') {
          // Query operation
          if (!params.query) {
            throw new Error('SQL Query is required for Query operation')
          }

          result.query = params.query
          if (params.pipeline) {
            result.pipeline = params.pipeline
          }
        } else if (operation === 'tinybird_query_pipe') {
          // Query Pipe Endpoint operation
          if (!params.pipe) {
            throw new Error('Pipe Name is required for Query Pipe Endpoint operation')
          }

          result.pipe = params.pipe
          if (params.parameters) {
            result.parameters = params.parameters
          }
          if (params.pipe_sql) {
            result.q = params.pipe_sql
          }
        } else if (operation === 'tinybird_append_datasource') {
          // Append Data Source from URL operation
          if (!params.datasource) {
            throw new Error('Data Source is required for Append Data Source operation')
          }
          if (!params.source_url) {
            throw new Error('Source File URL is required for Append Data Source operation')
          }

          result.datasource = params.datasource
          result.url = params.source_url
          result.format = params.source_format || 'csv'
        } else if (operation === 'tinybird_truncate_datasource') {
          // Truncate Data Source operation
          if (!params.datasource) {
            throw new Error('Data Source is required for Truncate Data Source operation')
          }

          result.datasource = params.datasource
        } else if (operation === 'tinybird_delete_datasource_rows') {
          // Delete Data Source Rows operation
          if (!params.datasource) {
            throw new Error('Data Source is required for Delete Data Source Rows operation')
          }
          if (!params.delete_condition) {
            throw new Error('Delete Condition is required for Delete Data Source Rows operation')
          }

          result.datasource = params.datasource
          result.delete_condition = params.delete_condition

          // Convert dry_run from string to boolean
          if (params.dry_run !== undefined) {
            const dryRunValue =
              typeof params.dry_run === 'string' ? params.dry_run.toLowerCase() : params.dry_run
            result.dry_run = dryRunValue === 'true' || dryRunValue === true
          }
        }

        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    base_url: { type: 'string', description: 'Tinybird API base URL' },
    // Send Events inputs
    datasource: {
      type: 'string',
      description: 'Name of the Tinybird Data Source',
    },
    data: {
      type: 'string',
      description: 'Data to send as JSON or NDJSON string',
    },
    wait: { type: 'boolean', description: 'Wait for database acknowledgment' },
    format: {
      type: 'string',
      description: 'Format of the events (ndjson or json)',
    },
    compression: {
      type: 'string',
      description: 'Compression format (none or gzip)',
    },
    // Query inputs
    query: { type: 'string', description: 'SQL query to execute' },
    pipeline: { type: 'string', description: 'Optional pipeline name' },
    // Query Pipe Endpoint inputs
    pipe: { type: 'string', description: 'Published Pipe API Endpoint name' },
    parameters: { type: 'json', description: 'Dynamic Pipe parameters as a JSON object' },
    pipe_sql: { type: 'string', description: 'Optional SQL to run on top of the Pipe result' },
    // Append Data Source inputs
    source_url: { type: 'string', description: 'URL of the file to append' },
    source_format: { type: 'string', description: 'Source file format (csv, ndjson, parquet)' },
    // Delete Data Source Rows inputs
    delete_condition: { type: 'string', description: 'SQL condition selecting rows to delete' },
    dry_run: { type: 'boolean', description: 'Test the delete without removing data' },
    // Common
    token: { type: 'string', description: 'Tinybird API Token' },
  },
  outputs: {
    // Send Events outputs
    successful_rows: {
      type: 'number',
      description: 'Number of rows successfully ingested',
    },
    quarantined_rows: {
      type: 'number',
      description: 'Number of rows quarantined (failed validation)',
    },
    // Query outputs
    data: {
      type: 'json',
      description:
        'Query result data. FORMAT JSON: array of objects. Other formats (CSV, TSV, etc.): raw text string.',
    },
    meta: {
      type: 'json',
      description: 'Column metadata for the result set: [{name, type}] (only with FORMAT JSON)',
    },
    rows: { type: 'number', description: 'Number of rows returned (only with FORMAT JSON)' },
    rows_before_limit_at_least: {
      type: 'number',
      description: 'Minimum rows without a LIMIT clause (only with FORMAT JSON)',
    },
    statistics: {
      type: 'json',
      description:
        'Query execution statistics - elapsed time, rows read, bytes read (only with FORMAT JSON)',
    },
    // Data Source management outputs (append / truncate / delete)
    id: { type: 'string', description: 'Operation identifier (append/delete)' },
    import_id: { type: 'string', description: 'Import identifier (append)' },
    job_id: { type: 'string', description: 'Job identifier to poll status (append/delete)' },
    delete_id: { type: 'string', description: 'Deletion identifier (delete)' },
    job_url: { type: 'string', description: 'URL to query job status (append/delete)' },
    status: { type: 'string', description: 'Current job status (append/delete)' },
    job: {
      type: 'json',
      description: 'Full job details: kind, id, status, datasource, rows_affected (append/delete)',
    },
    datasource: { type: 'json', description: 'Target Data Source metadata (append)' },
    truncated: { type: 'boolean', description: 'Whether the Data Source was truncated' },
    result: { type: 'json', description: 'Raw truncate response body, if any' },
  },
}
