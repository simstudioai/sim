import { TinybirdIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { TinybirdResponse } from '@/tools/tinybird/types'

export const TinybirdBlock: BlockConfig<TinybirdResponse> = {
  type: 'tinybird',
  name: 'Tinybird',
  description: 'Send events, query data, and manage Data Sources with Tinybird',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Interact with Tinybird: stream JSON or NDJSON events with the Events API, run SQL with the Query API, call published Pipe API Endpoints by name with dynamic parameters, manage Data Sources by appending from a URL, truncating, or deleting rows by condition, and poll the status of asynchronous jobs.',
  docsLink: 'https://docs.sim.ai/integrations/tinybird',
  category: 'tools',
  integrationType: IntegrationType.Analytics,
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
        { label: 'Get Job Status', id: 'tinybird_get_job' },
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
    // Get Job Status operation inputs
    {
      id: 'job_id',
      title: 'Job ID',
      type: 'short-input',
      placeholder: 'Job ID returned by an append or delete operation',
      condition: { field: 'operation', value: 'tinybird_get_job' },
      required: true,
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
      'tinybird_get_job',
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
        } else if (operation === 'tinybird_get_job') {
          // Get Job Status operation
          if (!params.job_id) {
            throw new Error('Job ID is required for Get Job Status operation')
          }

          result.job_id = params.job_id
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
    // Get Job Status inputs
    job_id: { type: 'string', description: 'ID of the job to check' },
    // Common
    token: { type: 'string', description: 'Tinybird API Token' },
  },
  outputs: {
    // Send Events outputs
    successful_rows: {
      type: 'number',
      description: 'Number of rows successfully ingested',
      condition: { field: 'operation', value: 'tinybird_events' },
    },
    quarantined_rows: {
      type: 'number',
      description: 'Number of rows quarantined (failed validation)',
      condition: { field: 'operation', value: 'tinybird_events' },
    },
    // Query / Query Pipe outputs
    data: {
      type: 'json',
      description:
        'Query result data. FORMAT JSON: array of objects. Other formats (CSV, TSV, etc.): raw text string.',
      condition: { field: 'operation', value: ['tinybird_query', 'tinybird_query_pipe'] },
    },
    meta: {
      type: 'json',
      description: 'Column metadata for the result set: [{name, type}] (only with FORMAT JSON)',
      condition: { field: 'operation', value: ['tinybird_query', 'tinybird_query_pipe'] },
    },
    rows: {
      type: 'number',
      description: 'Number of rows returned (only with FORMAT JSON)',
      condition: { field: 'operation', value: ['tinybird_query', 'tinybird_query_pipe'] },
    },
    rows_before_limit_at_least: {
      type: 'number',
      description: 'Minimum rows without a LIMIT clause (only with FORMAT JSON)',
      condition: { field: 'operation', value: ['tinybird_query', 'tinybird_query_pipe'] },
    },
    statistics: {
      type: 'json',
      description:
        'Query execution statistics - elapsed time, rows read, bytes read (only with FORMAT JSON)',
      condition: { field: 'operation', value: ['tinybird_query', 'tinybird_query_pipe'] },
    },
    // Data Source management outputs (append / truncate / delete / get job)
    id: {
      type: 'string',
      description: 'Operation identifier',
      condition: {
        field: 'operation',
        value: [
          'tinybird_append_datasource',
          'tinybird_delete_datasource_rows',
          'tinybird_get_job',
        ],
      },
    },
    import_id: {
      type: 'string',
      description: 'Import identifier (append)',
      condition: { field: 'operation', value: 'tinybird_append_datasource' },
    },
    job_id: {
      type: 'string',
      description:
        'Job identifier to poll with the Get Job Status operation (append/delete/get job)',
      condition: {
        field: 'operation',
        value: [
          'tinybird_append_datasource',
          'tinybird_delete_datasource_rows',
          'tinybird_get_job',
        ],
      },
    },
    delete_id: {
      type: 'string',
      description: 'Deletion identifier (delete)',
      condition: { field: 'operation', value: 'tinybird_delete_datasource_rows' },
    },
    job_url: {
      type: 'string',
      description: 'URL to query job status (append/delete/get job)',
      condition: {
        field: 'operation',
        value: [
          'tinybird_append_datasource',
          'tinybird_delete_datasource_rows',
          'tinybird_get_job',
        ],
      },
    },
    status: {
      type: 'string',
      description: 'Current job status (append/delete/get job)',
      condition: {
        field: 'operation',
        value: [
          'tinybird_append_datasource',
          'tinybird_delete_datasource_rows',
          'tinybird_get_job',
        ],
      },
    },
    job: {
      type: 'json',
      description:
        'Full job details: kind, id, status, datasource, rows_affected (append/delete/get job)',
      condition: {
        field: 'operation',
        value: [
          'tinybird_append_datasource',
          'tinybird_delete_datasource_rows',
          'tinybird_get_job',
        ],
      },
    },
    datasource: {
      type: 'json',
      description: 'Target Data Source metadata (append)',
      condition: { field: 'operation', value: 'tinybird_append_datasource' },
    },
    truncated: {
      type: 'boolean',
      description: 'Whether the Data Source was truncated',
      condition: { field: 'operation', value: 'tinybird_truncate_datasource' },
    },
    result: {
      type: 'json',
      description: 'Raw truncate response body, if any',
      condition: { field: 'operation', value: 'tinybird_truncate_datasource' },
    },
    // Get Job Status outputs
    kind: {
      type: 'string',
      description: 'Job kind (e.g., "import", "delete_data", "populateview", "copy")',
      condition: { field: 'operation', value: 'tinybird_get_job' },
    },
    created_at: {
      type: 'string',
      description: 'Timestamp the job was created',
      condition: { field: 'operation', value: 'tinybird_get_job' },
    },
    started_at: {
      type: 'string',
      description: 'Timestamp the job started running',
      condition: { field: 'operation', value: 'tinybird_get_job' },
    },
    updated_at: {
      type: 'string',
      description: 'Timestamp of the last job status update',
      condition: { field: 'operation', value: 'tinybird_get_job' },
    },
    is_cancellable: {
      type: 'boolean',
      description: 'Whether the job can still be cancelled',
      condition: { field: 'operation', value: 'tinybird_get_job' },
    },
    error: {
      type: 'string',
      description: 'Error message, present only when the job status is "error"',
      condition: { field: 'operation', value: 'tinybird_get_job' },
    },
  },
}

export const TinybirdBlockMeta = {
  tags: ['data-warehouse', 'data-analytics'],
  url: 'https://www.tinybird.co',
  templates: [
    {
      icon: TinybirdIcon,
      title: 'Tinybird pipe-as-API endpoint',
      prompt:
        'Create a workflow that calls a Tinybird published pipe with parameters on a schedule, normalizes the results, and writes them into a Sim table for downstream consumers.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['analysis', 'sync'],
    },
    {
      icon: TinybirdIcon,
      title: 'Tinybird realtime metric watcher',
      prompt:
        'Build a workflow that polls a Tinybird pipe every minute for a realtime KPI, compares against a rolling baseline, and pages PagerDuty when the metric crosses a SLO threshold.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'monitoring'],
      alsoIntegrations: ['pagerduty'],
    },
    {
      icon: TinybirdIcon,
      title: 'Tinybird user-segment exporter',
      prompt:
        'Create a workflow that calls a Tinybird published endpoint with segment parameters, writes the user list to a table, and feeds it to a Loops campaign for targeted activation messaging.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'sync'],
      alsoIntegrations: ['loops'],
    },
    {
      icon: TinybirdIcon,
      title: 'Tinybird usage-meter dashboard',
      prompt:
        'Build a workflow that exposes a Tinybird endpoint reporting per-customer usage for billing, refreshes a Sim table hourly, and surfaces top consumers to Slack.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: TinybirdIcon,
      title: 'Tinybird funnel analytics digest',
      prompt:
        'Create a scheduled workflow that queries a Tinybird pipe for daily signup, activation, and conversion counts, calculates step-over-step drop-off, and posts a funnel digest with week-over-week deltas to the growth Slack channel.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['analysis', 'reporting', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: TinybirdIcon,
      title: 'Tinybird anomaly investigator',
      prompt:
        'Build a workflow triggered by an alert that calls a Tinybird pipe to pull the surrounding event data for the affected metric, has an agent summarize the likely cause, and opens a Linear issue with the supporting query results attached.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'analysis', 'monitoring'],
      alsoIntegrations: ['linear'],
    },
    {
      icon: TinybirdIcon,
      title: 'Tinybird executive KPI report',
      prompt:
        'Create a scheduled weekly workflow that queries several Tinybird pipes for the company’s headline KPIs, assembles them into a Markdown report file with trend commentary, and emails it to the leadership team.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['reporting', 'analysis', 'enterprise'],
      alsoIntegrations: ['gmail'],
    },
  ],
  skills: [
    {
      name: 'ingest-events',
      description: 'Stream JSON or NDJSON events into a Tinybird Data Source via the Events API.',
      content:
        '# Ingest Events into Tinybird\n\nStream realtime events into a Data Source so they are queryable within seconds.\n\n## Steps\n1. Use the Send Events operation with your Base URL and API Token.\n2. Set the Data Source name that matches your target table.\n3. Provide the events in the Data field, using NDJSON (one JSON object per line) for batches or JSON for a single object.\n4. Enable Wait for Acknowledgment when you need confirmation the rows landed before continuing.\n\n## Output\nReturn the count of successful_rows and quarantined_rows so you can confirm ingestion and catch rows that failed validation.',
    },
    {
      name: 'query-pipe-endpoint',
      description:
        'Call a published Tinybird Pipe API Endpoint with dynamic parameters and return the result.',
      content:
        '# Query a Tinybird Pipe Endpoint\n\nCall a published Pipe by name to get analytics results shaped by dynamic parameters.\n\n## Steps\n1. Use the Query Pipe Endpoint operation with the Base URL, API Token, and the Pipe Name (for example top_pages).\n2. Pass dynamic Parameters as a JSON object whose keys match the parameters the Pipe expects (for example start_date and limit).\n3. Optionally add SQL on top of the Pipe result using the advanced SQL field, selecting from _ to post-process.\n\n## Output\nReturn the result rows as JSON along with the column metadata and row count, ready to write to a table or summarize.',
    },
    {
      name: 'run-sql-query',
      description:
        'Run an ad-hoc SQL query against Tinybird with the Query API and return results.',
      content:
        '# Run a Tinybird SQL Query\n\nExecute SQL directly against your Tinybird data for ad-hoc analysis.\n\n## Steps\n1. Use the Query operation with the Base URL and API Token.\n2. Write the SQL Query and append FORMAT JSON to get structured rows back (other formats return raw text).\n3. Reference Data Sources or Pipes by name in the FROM clause.\n\n## Output\nReturn the result data as an array of objects plus the column metadata, row count, and execution statistics.',
    },
    {
      name: 'manage-datasource-rows',
      description:
        'Append from a URL, truncate, or delete rows by condition in a Tinybird Data Source.',
      content:
        "# Manage Tinybird Data Source Rows\n\nMaintain a Data Source by loading, clearing, or pruning its rows.\n\n## Steps\n1. To load data, use Append Data Source (from URL) with the Data Source name, a Source File URL, and the source format (CSV, NDJSON, or Parquet).\n2. To clear everything, use Truncate Data Source with the Data Source name.\n3. To remove specific rows, use Delete Data Source Rows with a SQL Delete Condition such as event_date < '2024-01-01'.\n4. Enable Dry Run on a delete first to preview how many rows would be removed.\n\n## Output\nReturn the job ID and status for append and delete operations so you can poll with Get Job Status, or confirm the truncate succeeded.",
    },
    {
      name: 'poll-job-status',
      description:
        'Check the status of an asynchronous Tinybird job, such as an append import or a delete-by-condition job.',
      content:
        '# Poll a Tinybird Job\n\nAppend Data Source and Delete Data Source Rows start asynchronous jobs that need to be polled for completion.\n\n## Steps\n1. Take the Job ID returned by Append Data Source or Delete Data Source Rows.\n2. Use the Get Job Status operation with the Base URL, API Token, and Job ID.\n3. Loop or wait until status is "done" (or "error"), checking again on a delay if still "waiting" or "working".\n\n## Output\nReturn the job kind, status, and full job details so you can confirm completion or surface the error message.',
    },
  ],
} as const satisfies BlockMeta
