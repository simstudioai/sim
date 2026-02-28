import { DatabricksIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { DatabricksResponse } from '@/tools/databricks/types'

export const DatabricksBlock: BlockConfig<DatabricksResponse> = {
  type: 'databricks',
  name: 'Databricks',
  description: 'Run SQL queries and manage jobs on Databricks',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Connect to Databricks to execute SQL queries against SQL warehouses, trigger and monitor job runs, manage clusters, and retrieve run outputs. Requires a Personal Access Token and workspace host URL.',
  docsLink: 'https://docs.sim.ai/tools/databricks',
  category: 'tools',
  bgColor: '#F9F7F4',
  icon: DatabricksIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Execute SQL', id: 'execute_sql' },
        { label: 'List Jobs', id: 'list_jobs' },
        { label: 'Run Job', id: 'run_job' },
        { label: 'Get Run', id: 'get_run' },
        { label: 'List Runs', id: 'list_runs' },
        { label: 'Cancel Run', id: 'cancel_run' },
        { label: 'Get Run Output', id: 'get_run_output' },
        { label: 'List Clusters', id: 'list_clusters' },
      ],
      value: () => 'execute_sql',
    },

    // ── Execute SQL ──
    {
      id: 'warehouseId',
      title: 'Warehouse ID',
      type: 'short-input',
      placeholder: 'Enter SQL warehouse ID',
      condition: { field: 'operation', value: 'execute_sql' },
      required: { field: 'operation', value: 'execute_sql' },
    },
    {
      id: 'statement',
      title: 'SQL Statement',
      type: 'code',
      placeholder: 'SELECT * FROM my_table LIMIT 10',
      condition: { field: 'operation', value: 'execute_sql' },
      required: { field: 'operation', value: 'execute_sql' },
    },
    {
      id: 'catalog',
      title: 'Catalog',
      type: 'short-input',
      placeholder: 'Unity Catalog name',
      condition: { field: 'operation', value: 'execute_sql' },
      mode: 'advanced',
    },
    {
      id: 'schema',
      title: 'Schema',
      type: 'short-input',
      placeholder: 'Schema name',
      condition: { field: 'operation', value: 'execute_sql' },
      mode: 'advanced',
    },
    {
      id: 'rowLimit',
      title: 'Row Limit',
      type: 'short-input',
      placeholder: 'Max rows to return',
      condition: { field: 'operation', value: 'execute_sql' },
      mode: 'advanced',
    },
    {
      id: 'waitTimeout',
      title: 'Wait Timeout',
      type: 'short-input',
      placeholder: '50s',
      condition: { field: 'operation', value: 'execute_sql' },
      mode: 'advanced',
    },

    // ── List Jobs ──
    {
      id: 'name',
      title: 'Job Name Filter',
      type: 'short-input',
      placeholder: 'Exact name filter (case-insensitive)',
      condition: { field: 'operation', value: 'list_jobs' },
    },
    {
      id: 'expandTasks',
      title: 'Expand Tasks',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'list_jobs' },
      mode: 'advanced',
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '20',
      condition: { field: 'operation', value: ['list_jobs', 'list_runs'] },
      mode: 'advanced',
    },
    {
      id: 'offset',
      title: 'Offset',
      type: 'short-input',
      placeholder: '0',
      condition: { field: 'operation', value: ['list_jobs', 'list_runs'] },
      mode: 'advanced',
    },

    // ── Run Job ──
    {
      id: 'jobId',
      title: 'Job ID',
      type: 'short-input',
      placeholder: 'Enter the job ID',
      condition: { field: 'operation', value: ['run_job', 'list_runs'] },
      required: { field: 'operation', value: 'run_job' },
    },
    {
      id: 'jobParameters',
      title: 'Job Parameters',
      type: 'code',
      placeholder: '{"key": "value"}',
      condition: { field: 'operation', value: 'run_job' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON object of job parameters based on the user's description.

Examples:
- "set date to yesterday" -> {"date": "2024-01-14"}
- "process the sales data for Q4" -> {"quarter": "Q4", "dataset": "sales"}
- "run with debug mode enabled" -> {"debug": "true"}

Return ONLY a valid JSON object - no explanations, no extra text.`,
        placeholder: 'Describe the job parameters (e.g., "set date to yesterday")...',
      },
    },
    {
      id: 'notebookParams',
      title: 'Notebook Parameters',
      type: 'code',
      placeholder: '{"param1": "value1"}',
      condition: { field: 'operation', value: 'run_job' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON object of notebook parameters based on the user's description.

Examples:
- "input path is /data/raw and output path is /data/processed" -> {"input_path": "/data/raw", "output_path": "/data/processed"}
- "batch size 1000, dry run" -> {"batch_size": "1000", "dry_run": "true"}

Return ONLY a valid JSON object - no explanations, no extra text.`,
        placeholder: 'Describe the notebook parameters...',
      },
    },
    {
      id: 'idempotencyToken',
      title: 'Idempotency Token',
      type: 'short-input',
      placeholder: 'Unique token to prevent duplicate runs (max 64 chars)',
      condition: { field: 'operation', value: 'run_job' },
      mode: 'advanced',
    },

    // ── Get Run ──
    {
      id: 'runId',
      title: 'Run ID',
      type: 'short-input',
      placeholder: 'Enter the run ID',
      condition: { field: 'operation', value: ['get_run', 'cancel_run', 'get_run_output'] },
      required: { field: 'operation', value: ['get_run', 'cancel_run', 'get_run_output'] },
    },
    {
      id: 'includeHistory',
      title: 'Include History',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'get_run' },
      mode: 'advanced',
    },
    {
      id: 'includeResolvedValues',
      title: 'Include Resolved Values',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'get_run' },
      mode: 'advanced',
    },

    // ── List Runs ──
    {
      id: 'activeOnly',
      title: 'Active Only',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'list_runs' },
      mode: 'advanced',
    },
    {
      id: 'completedOnly',
      title: 'Completed Only',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'list_runs' },
      mode: 'advanced',
    },
    {
      id: 'runType',
      title: 'Run Type',
      type: 'dropdown',
      options: [
        { label: 'All', id: '' },
        { label: 'Job Run', id: 'JOB_RUN' },
        { label: 'Workflow Run', id: 'WORKFLOW_RUN' },
        { label: 'Submit Run', id: 'SUBMIT_RUN' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'list_runs' },
      mode: 'advanced',
    },
    {
      id: 'startTimeFrom',
      title: 'Start Time From',
      type: 'short-input',
      placeholder: 'Epoch ms (e.g., 1700000000000)',
      condition: { field: 'operation', value: 'list_runs' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Convert the user's date/time description to an epoch timestamp in milliseconds.

Examples:
- "yesterday" -> epoch ms for yesterday at 00:00 UTC
- "last week" -> epoch ms for 7 days ago at 00:00 UTC
- "2024-01-15" -> epoch ms for 2024-01-15T00:00:00Z
- "start of this month" -> epoch ms for 1st day of current month

Return ONLY the numeric timestamp in milliseconds - no explanations, no extra text.`,
        placeholder: 'Describe the start time (e.g., "yesterday", "last week")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'startTimeTo',
      title: 'Start Time To',
      type: 'short-input',
      placeholder: 'Epoch ms (e.g., 1700100000000)',
      condition: { field: 'operation', value: 'list_runs' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Convert the user's date/time description to an epoch timestamp in milliseconds.

Examples:
- "now" -> current epoch ms
- "today" -> epoch ms for today at 23:59:59 UTC
- "end of last week" -> epoch ms for last Sunday at 23:59:59 UTC
- "2024-01-15" -> epoch ms for 2024-01-15T23:59:59Z

Return ONLY the numeric timestamp in milliseconds - no explanations, no extra text.`,
        placeholder: 'Describe the end time (e.g., "now", "end of last week")...',
        generationType: 'timestamp',
      },
    },

    // ── Credentials (common to all operations) ──
    {
      id: 'host',
      title: 'Workspace Host',
      type: 'short-input',
      placeholder: 'dbc-abc123.cloud.databricks.com',
      required: true,
    },
    {
      id: 'apiKey',
      title: 'Access Token',
      type: 'short-input',
      placeholder: 'Enter your Databricks Personal Access Token',
      password: true,
      required: true,
    },
  ],
  tools: {
    access: [
      'databricks_execute_sql',
      'databricks_list_jobs',
      'databricks_run_job',
      'databricks_get_run',
      'databricks_list_runs',
      'databricks_cancel_run',
      'databricks_get_run_output',
      'databricks_list_clusters',
    ],
    config: {
      tool: (params) => `databricks_${params.operation}`,
      params: (params) => {
        const result: Record<string, unknown> = {}
        if (params.jobId) result.jobId = Number(params.jobId)
        if (params.runId) result.runId = Number(params.runId)
        if (params.rowLimit) result.rowLimit = Number(params.rowLimit)
        if (params.limit) result.limit = Number(params.limit)
        if (params.offset) result.offset = Number(params.offset)
        if (params.startTimeFrom) result.startTimeFrom = Number(params.startTimeFrom)
        if (params.startTimeTo) result.startTimeTo = Number(params.startTimeTo)
        result.includeHistory = params.includeHistory === 'true'
        result.includeResolvedValues = params.includeResolvedValues === 'true'
        result.activeOnly = params.activeOnly === 'true'
        result.completedOnly = params.completedOnly === 'true'
        result.expandTasks = params.expandTasks === 'true'
        if (params.runType === '') result.runType = undefined
        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    host: { type: 'string', description: 'Databricks workspace host URL' },
    apiKey: { type: 'string', description: 'Databricks Personal Access Token' },
    warehouseId: { type: 'string', description: 'SQL warehouse ID' },
    statement: { type: 'string', description: 'SQL statement to execute' },
    catalog: { type: 'string', description: 'Unity Catalog name' },
    schema: { type: 'string', description: 'Schema name' },
    rowLimit: { type: 'number', description: 'Maximum rows to return' },
    waitTimeout: { type: 'string', description: 'Wait timeout (e.g., "50s")' },
    jobId: { type: 'number', description: 'Job ID' },
    jobParameters: { type: 'string', description: 'Job-level parameters as JSON' },
    notebookParams: { type: 'string', description: 'Notebook task parameters as JSON' },
    idempotencyToken: { type: 'string', description: 'Idempotency token for duplicate prevention' },
    runId: { type: 'number', description: 'Run ID' },
    includeHistory: { type: 'boolean', description: 'Include repair history' },
    includeResolvedValues: { type: 'boolean', description: 'Include resolved parameter values' },
    name: { type: 'string', description: 'Job name filter' },
    limit: { type: 'number', description: 'Maximum results to return' },
    offset: { type: 'number', description: 'Pagination offset' },
    expandTasks: { type: 'boolean', description: 'Include task and cluster details' },
    activeOnly: { type: 'boolean', description: 'Only active runs' },
    completedOnly: { type: 'boolean', description: 'Only completed runs' },
    runType: { type: 'string', description: 'Filter by run type' },
    startTimeFrom: { type: 'number', description: 'Filter runs started after (epoch ms)' },
    startTimeTo: { type: 'number', description: 'Filter runs started before (epoch ms)' },
  },
  outputs: {
    // Execute SQL
    statementId: { type: 'string', description: 'Statement ID' },
    status: { type: 'string', description: 'Execution status' },
    columns: { type: 'json', description: 'Result column schema' },
    data: { type: 'json', description: 'Result rows as 2D array' },
    totalRows: { type: 'number', description: 'Total row count' },
    truncated: { type: 'boolean', description: 'Whether results were truncated' },
    // List Jobs
    jobs: { type: 'json', description: 'List of jobs' },
    hasMore: { type: 'boolean', description: 'Whether more results are available' },
    nextPageToken: { type: 'string', description: 'Pagination token for next page' },
    // Run Job
    runId: { type: 'number', description: 'Triggered run ID' },
    numberInJob: { type: 'number', description: 'Run sequence number in job' },
    // Get Run
    jobId: { type: 'number', description: 'Job ID the run belongs to' },
    runName: { type: 'string', description: 'Run name' },
    runType: { type: 'string', description: 'Run type (JOB_RUN, WORKFLOW_RUN, SUBMIT_RUN)' },
    attemptNumber: { type: 'number', description: 'Retry attempt number' },
    state: {
      type: 'json',
      description: 'Run state with lifeCycleState, resultState, stateMessage',
    },
    startTime: { type: 'number', description: 'Run start time (epoch ms)' },
    endTime: { type: 'number', description: 'Run end time (epoch ms)' },
    setupDuration: { type: 'number', description: 'Cluster setup duration (ms)' },
    executionDuration: { type: 'number', description: 'Execution duration (ms)' },
    cleanupDuration: { type: 'number', description: 'Cleanup duration (ms)' },
    queueDuration: { type: 'number', description: 'Time spent in queue (ms)' },
    runPageUrl: { type: 'string', description: 'URL to run detail page' },
    creatorUserName: { type: 'string', description: 'Run creator email' },
    // List Runs
    runs: { type: 'json', description: 'List of job runs' },
    // Cancel Run
    success: { type: 'boolean', description: 'Whether the cancel request was accepted' },
    // Get Run Output
    notebookOutput: { type: 'json', description: 'Notebook task output' },
    error: { type: 'string', description: 'Error message if run failed' },
    errorTrace: { type: 'string', description: 'Error stack trace' },
    logs: { type: 'string', description: 'Run log output' },
    logsTruncated: { type: 'boolean', description: 'Whether logs were truncated' },
    // List Clusters
    clusters: { type: 'json', description: 'List of clusters' },
  },
}
