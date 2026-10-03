import { DatabricksIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'

/** A run is parameterized either at the job level or per notebook, never both. */
const DATABRICKS_RUN_PARAMS_FIELD = ['jobParameters', 'notebookParams'] as const

/** Genie operations that act on one message's query attachment. */
const GENIE_ATTACHMENT_OPERATIONS = [
  'genie_get_query_result',
  'genie_execute_query',
  'genie_download_visualization',
]

/** Genie operations that address one message in a conversation. */
const GENIE_MESSAGE_OPERATIONS = [
  'genie_get_message',
  'genie_send_feedback',
  'genie_delete_message',
  ...GENIE_ATTACHMENT_OPERATIONS,
]

/** Genie operations that require an existing conversation. */
const GENIE_CONVERSATION_OPERATIONS = [
  ...GENIE_MESSAGE_OPERATIONS,
  'genie_list_messages',
  'genie_delete_conversation',
  'genie_agent_list_items',
]

/** Genie operations that ask a question, optionally continuing a conversation. */
const GENIE_ASK_OPERATIONS = ['genie_ask', 'genie_agent_ask']

/** Genie operations scoped to one Genie space. */
const GENIE_SPACE_OPERATIONS = [
  ...GENIE_ASK_OPERATIONS,
  ...GENIE_CONVERSATION_OPERATIONS,
  'genie_list_conversations',
  'genie_get_space',
]

/** Genie list operations paginated with page_size / page_token. */
const GENIE_PAGED_OPERATIONS = [
  'genie_list_spaces',
  'genie_list_conversations',
  'genie_list_messages',
]

export const DatabricksBlock: BlockConfig = {
  type: 'databricks',
  name: 'Databricks',
  description: 'Run SQL, manage jobs, and ask Genie agents on Databricks',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Connect to Databricks to execute SQL queries against SQL warehouses, trigger and monitor job runs, manage clusters, and retrieve run outputs. Ask Genie spaces (Genie agents) questions in natural language and get back answers, the generated SQL, result rows, and charts, continuing a conversation across follow-ups, or run Genie agent mode for multi-step research reports. Requires a Personal Access Token and workspace host URL.',
  docsLink: 'https://docs.sim.ai/integrations/databricks',
  category: 'tools',
  integrationType: IntegrationType.Databases,
  bgColor: '#F9F7F4',
  icon: DatabricksIcon,
  canvasPresentation: {
    defaultTitle: 'Databricks',
    sentences: {
      byOperation: {
        execute_sql: [
          { text: 'Run', field: 'statement', core: true },
          { text: 'on warehouse', field: 'warehouseId' },
        ],
        get_statement: [
          {
            text: 'Poll SQL statement',
            field: 'statementId',
            after: 'for results',
            core: true,
          },
        ],
        list_warehouses: ['List all SQL warehouses'],
        list_jobs: [
          'List jobs',
          { text: ', named', field: 'name' },
          { text: ', up to', field: 'limit' },
        ],
        get_job: [{ text: 'Read the definition of job', field: 'jobId', core: true }],
        run_job: [
          { text: 'Trigger job', field: 'jobId', core: true },
          { text: ', with', field: DATABRICKS_RUN_PARAMS_FIELD },
        ],
        get_run: [{ text: 'Read the status of run', field: 'runId', core: true }],
        list_runs: [
          'List job runs',
          { text: ', for job', field: 'jobId' },
          { text: ', started after', field: 'startTimeFrom' },
        ],
        cancel_run: [{ text: 'Cancel run', field: 'runId', core: true }],
        get_run_output: [{ text: 'Read the output of run', field: 'runId', core: true }],
        list_clusters: ['List all clusters'],
        get_cluster: [
          { text: 'Read the configuration of cluster', field: 'clusterId', core: true },
        ],
        genie_ask: [
          { text: 'Ask Genie', field: 'content', core: true },
          { text: ', in space', field: 'spaceId' },
        ],
        genie_get_message: [{ text: 'Read Genie message', field: 'messageId', core: true }],
        genie_list_messages: [
          { text: 'List messages in Genie conversation', field: 'conversationId', core: true },
        ],
        genie_get_query_result: [
          { text: 'Read the query result of Genie message', field: 'messageId', core: true },
        ],
        genie_execute_query: [
          { text: 'Re-run the query of Genie message', field: 'messageId', core: true },
        ],
        genie_download_visualization: [
          { text: 'Download the chart of Genie message', field: 'messageId', core: true },
        ],
        genie_send_feedback: [
          { text: 'Rate Genie message', field: 'messageId', core: true },
          { text: ' as', field: 'rating' },
        ],
        genie_delete_message: [{ text: 'Delete Genie message', field: 'messageId', core: true }],
        genie_list_conversations: [
          { text: 'List Genie conversations in space', field: 'spaceId', core: true },
        ],
        genie_delete_conversation: [
          { text: 'Delete Genie conversation', field: 'conversationId', core: true },
        ],
        genie_list_spaces: ['List Genie spaces'],
        genie_get_space: [{ text: 'Read Genie space', field: 'spaceId', core: true }],
        genie_agent_ask: [
          { text: 'Ask Genie agent', field: 'content', core: true },
          { text: ', in space', field: 'spaceId' },
        ],
        genie_agent_list_items: [
          {
            text: 'List the history of Genie agent conversation',
            field: 'conversationId',
            core: true,
          },
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
        { label: 'Execute SQL', id: 'execute_sql' },
        { label: 'Get Statement', id: 'get_statement' },
        { label: 'List Warehouses', id: 'list_warehouses' },
        { label: 'List Jobs', id: 'list_jobs' },
        { label: 'Get Job', id: 'get_job' },
        { label: 'Run Job', id: 'run_job' },
        { label: 'Get Run', id: 'get_run' },
        { label: 'List Runs', id: 'list_runs' },
        { label: 'Cancel Run', id: 'cancel_run' },
        { label: 'Get Run Output', id: 'get_run_output' },
        { label: 'List Clusters', id: 'list_clusters' },
        { label: 'Get Cluster', id: 'get_cluster' },
        { label: 'Ask Genie', id: 'genie_ask' },
        { label: 'Get Genie Message', id: 'genie_get_message' },
        { label: 'List Genie Messages', id: 'genie_list_messages' },
        { label: 'Get Genie Query Result', id: 'genie_get_query_result' },
        { label: 'Execute Genie Query', id: 'genie_execute_query' },
        { label: 'Download Genie Visualization', id: 'genie_download_visualization' },
        { label: 'Send Genie Feedback', id: 'genie_send_feedback' },
        { label: 'Delete Genie Message', id: 'genie_delete_message' },
        { label: 'List Genie Conversations', id: 'genie_list_conversations' },
        { label: 'Delete Genie Conversation', id: 'genie_delete_conversation' },
        { label: 'List Genie Spaces', id: 'genie_list_spaces' },
        { label: 'Get Genie Space', id: 'genie_get_space' },
        { label: 'Ask Genie Agent', id: 'genie_agent_ask' },
        { label: 'List Genie Agent Items', id: 'genie_agent_list_items' },
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

    // ── Get Statement ──
    {
      id: 'statementId',
      title: 'Statement ID',
      type: 'short-input',
      placeholder: 'Enter the statement ID',
      condition: { field: 'operation', value: 'get_statement' },
      required: { field: 'operation', value: 'get_statement' },
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
      condition: {
        field: 'operation',
        value: ['list_jobs', 'list_runs', 'genie_agent_list_items'],
      },
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
      condition: { field: 'operation', value: ['run_job', 'list_runs', 'get_job'] },
      required: { field: 'operation', value: ['run_job', 'get_job'] },
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

    // ── Get Cluster ──
    {
      id: 'clusterId',
      title: 'Cluster ID',
      type: 'short-input',
      placeholder: 'Enter the cluster ID',
      condition: { field: 'operation', value: 'get_cluster' },
      required: { field: 'operation', value: 'get_cluster' },
    },

    // ── Genie ──
    {
      id: 'spaceId',
      title: 'Genie Space ID',
      type: 'short-input',
      placeholder: 'Enter the Genie space (agent) ID',
      condition: { field: 'operation', value: GENIE_SPACE_OPERATIONS },
      required: { field: 'operation', value: GENIE_SPACE_OPERATIONS },
    },
    {
      id: 'content',
      title: 'Question',
      type: 'long-input',
      placeholder: 'What were total sales by region last quarter?',
      condition: { field: 'operation', value: GENIE_ASK_OPERATIONS },
      required: { field: 'operation', value: GENIE_ASK_OPERATIONS },
    },
    {
      id: 'conversationId',
      title: 'Conversation ID',
      type: 'short-input',
      placeholder: 'Enter the conversation ID (leave empty to start a new one when asking)',
      condition: {
        field: 'operation',
        value: [...GENIE_ASK_OPERATIONS, ...GENIE_CONVERSATION_OPERATIONS],
      },
      required: { field: 'operation', value: GENIE_CONVERSATION_OPERATIONS },
    },
    {
      id: 'messageId',
      title: 'Message ID',
      type: 'short-input',
      placeholder: 'Enter the Genie message ID',
      condition: { field: 'operation', value: GENIE_MESSAGE_OPERATIONS },
      required: { field: 'operation', value: GENIE_MESSAGE_OPERATIONS },
    },
    {
      id: 'attachmentId',
      title: 'Attachment ID',
      type: 'short-input',
      placeholder: 'queryAttachmentId, or a visualization attachmentId for charts',
      condition: { field: 'operation', value: GENIE_ATTACHMENT_OPERATIONS },
      required: { field: 'operation', value: GENIE_ATTACHMENT_OPERATIONS },
    },
    {
      id: 'enableVisualization',
      title: 'Generate Charts',
      type: 'switch',
      condition: { field: 'operation', value: GENIE_ASK_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'rating',
      title: 'Rating',
      type: 'dropdown',
      options: [
        { label: 'Positive', id: 'POSITIVE' },
        { label: 'Negative', id: 'NEGATIVE' },
        { label: 'None (clear rating)', id: 'NONE' },
      ],
      value: () => 'POSITIVE',
      condition: { field: 'operation', value: 'genie_send_feedback' },
      required: { field: 'operation', value: 'genie_send_feedback' },
    },
    {
      id: 'comment',
      title: 'Comment',
      type: 'long-input',
      placeholder: 'Optional feedback comment',
      condition: { field: 'operation', value: 'genie_send_feedback' },
    },
    {
      id: 'includeAll',
      title: 'Include All Users',
      type: 'switch',
      condition: { field: 'operation', value: 'genie_list_conversations' },
      mode: 'advanced',
    },
    {
      id: 'includeSerializedSpace',
      title: 'Include Configuration',
      type: 'switch',
      condition: { field: 'operation', value: 'genie_get_space' },
      mode: 'advanced',
    },
    {
      id: 'pageSize',
      title: 'Page Size',
      type: 'short-input',
      placeholder: '20 (max 100)',
      condition: { field: 'operation', value: GENIE_PAGED_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'pageToken',
      title: 'Page Token',
      type: 'short-input',
      placeholder: 'nextPageToken from a previous call',
      condition: { field: 'operation', value: GENIE_PAGED_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'after',
      title: 'After',
      type: 'short-input',
      placeholder: 'lastId from a previous call',
      condition: { field: 'operation', value: 'genie_agent_list_items' },
      mode: 'advanced',
    },
    {
      id: 'order',
      title: 'Order',
      type: 'dropdown',
      options: [
        { label: 'Oldest first', id: 'asc' },
        { label: 'Newest first', id: 'desc' },
      ],
      value: () => 'asc',
      condition: { field: 'operation', value: 'genie_agent_list_items' },
      mode: 'advanced',
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
      'databricks_get_statement',
      'databricks_list_warehouses',
      'databricks_list_jobs',
      'databricks_get_job',
      'databricks_run_job',
      'databricks_get_run',
      'databricks_list_runs',
      'databricks_cancel_run',
      'databricks_get_run_output',
      'databricks_list_clusters',
      'databricks_get_cluster',
      'databricks_genie_ask',
      'databricks_genie_get_message',
      'databricks_genie_list_messages',
      'databricks_genie_get_query_result',
      'databricks_genie_execute_query',
      'databricks_genie_download_visualization',
      'databricks_genie_send_feedback',
      'databricks_genie_delete_message',
      'databricks_genie_list_conversations',
      'databricks_genie_delete_conversation',
      'databricks_genie_list_spaces',
      'databricks_genie_get_space',
      'databricks_genie_agent_ask',
      'databricks_genie_agent_list_items',
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
        if (params.pageSize) result.pageSize = Number(params.pageSize)
        result.includeHistory = params.includeHistory === 'true'
        result.includeResolvedValues = params.includeResolvedValues === 'true'
        result.activeOnly = params.activeOnly === 'true'
        result.completedOnly = params.completedOnly === 'true'
        result.expandTasks = params.expandTasks === 'true'
        result.includeAll = params.includeAll === true || params.includeAll === 'true'
        result.includeSerializedSpace =
          params.includeSerializedSpace === true || params.includeSerializedSpace === 'true'
        result.enableVisualization =
          params.enableVisualization === true || params.enableVisualization === 'true'
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
    statementId: { type: 'string', description: 'Statement ID to poll for results' },
    clusterId: { type: 'string', description: 'Cluster ID to retrieve' },
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
    spaceId: { type: 'string', description: 'Genie space (agent) ID' },
    content: { type: 'string', description: 'Question to ask Genie' },
    conversationId: { type: 'string', description: 'Genie conversation ID' },
    messageId: { type: 'string', description: 'Genie message ID' },
    attachmentId: { type: 'string', description: 'Genie query or visualization attachment ID' },
    enableVisualization: { type: 'boolean', description: 'Ask Genie to generate charts' },
    rating: { type: 'string', description: 'Genie feedback rating (POSITIVE, NEGATIVE, NONE)' },
    comment: { type: 'string', description: 'Genie feedback comment' },
    includeAll: { type: 'boolean', description: "Include every user's Genie conversations" },
    includeSerializedSpace: {
      type: 'boolean',
      description: "Include the Genie space's serialized configuration",
    },
    pageSize: { type: 'number', description: 'Results per page' },
    pageToken: { type: 'string', description: 'Pagination token' },
    after: { type: 'string', description: 'Agent item pagination cursor' },
    order: { type: 'string', description: 'Agent item sort order (asc or desc)' },
  },
  outputs: {
    // Execute SQL
    statementId: { type: 'string', description: 'Statement ID' },
    status: { type: 'string', description: 'SQL statement, Genie message, or Genie agent status' },
    columns: { type: 'json', description: 'Result column schema' },
    data: { type: 'json', description: 'Result rows as 2D array' },
    totalRows: { type: 'number', description: 'Total row count' },
    truncated: { type: 'boolean', description: 'Whether results were truncated' },
    // List Jobs
    jobs: { type: 'json', description: 'List of jobs' },
    hasMore: {
      type: 'boolean',
      description: 'Whether more results or Genie agent items are available',
    },
    nextPageToken: { type: 'string', description: 'Pagination token for next page' },
    // List Warehouses
    warehouses: {
      type: 'json',
      description:
        'List of SQL warehouses ([{warehouseId, name, clusterSize, state, warehouseType, ...}])',
    },
    // Get Job
    name: { type: 'string', description: 'Job name' },
    runAsUserName: { type: 'string', description: 'User the job runs as' },
    format: { type: 'string', description: 'Job format (SINGLE_TASK or MULTI_TASK)' },
    maxConcurrentRuns: { type: 'number', description: 'Maximum number of concurrent runs' },
    timeoutSeconds: { type: 'number', description: 'Job-level timeout in seconds' },
    createdTime: { type: 'number', description: 'Job creation timestamp (epoch ms)' },
    schedule: {
      type: 'json',
      description: 'Cron schedule (quartz_cron_expression, timezone_id, pause_status)',
    },
    tags: { type: 'json', description: 'Key-value tags applied to the job' },
    tasks: { type: 'json', description: 'Task definitions for the job' },
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
    error: {
      type: 'string',
      description: 'Error message if the run failed or Genie could not answer',
    },
    errorTrace: { type: 'string', description: 'Error stack trace' },
    logs: { type: 'string', description: 'Run log output' },
    logsTruncated: { type: 'boolean', description: 'Whether logs were truncated' },
    // List Clusters
    clusters: { type: 'json', description: 'List of clusters' },
    // Get Cluster
    cluster: {
      type: 'json',
      description: 'Cluster detail (clusterId, clusterName, state, sparkVersion, autoscale, ...)',
    },
    // Genie (chat mode)
    conversationId: { type: 'string', description: 'Genie conversation ID' },
    messageId: { type: 'string', description: 'Genie message ID' },
    content: { type: 'string', description: 'Question asked to Genie' },
    answer: { type: 'string', description: "Genie's text answer or summary" },
    followUpQuestion: {
      type: 'string',
      description: 'Clarifying question Genie asked instead of, or alongside, an answer',
    },
    queryTitle: { type: 'string', description: 'Title of the generated query' },
    sql: { type: 'string', description: 'SQL query Genie generated' },
    queryDescription: { type: 'string', description: 'Description of the generated SQL' },
    queryAttachmentId: { type: 'string', description: 'Attachment ID of the generated query' },
    rowCount: { type: 'number', description: 'Rows returned by the generated query' },
    thoughts: {
      type: 'json',
      description: 'How Genie interpreted the question and built the SQL ([{type, content}])',
    },
    suggestedQuestions: { type: 'json', description: 'Follow-up questions suggested by Genie' },
    visualizations: {
      type: 'json',
      description: 'Charts Genie generated ([{attachmentId, title, queryAttachmentId}])',
    },
    errorType: { type: 'string', description: 'Genie error type when Genie failed to answer' },
    createdTimestamp: { type: 'number', description: 'When the Genie message was created' },
    messages: {
      type: 'json',
      description: 'Genie messages ([{messageId, content, status, answer, sql, ...}])',
    },
    file: { type: 'file', description: 'Downloaded Genie chart (PNG)' },
    conversations: {
      type: 'json',
      description: 'Genie conversations ([{conversationId, title, createdTimestamp, agentType}])',
    },
    // Genie spaces
    spaces: {
      type: 'json',
      description: 'Genie spaces ([{spaceId, title, description, warehouseId, ...}])',
    },
    spaceId: { type: 'string', description: 'Genie space ID' },
    title: { type: 'string', description: 'Genie space title' },
    description: { type: 'string', description: 'Genie space description' },
    warehouseId: { type: 'string', description: 'SQL warehouse the Genie space queries' },
    parentPath: { type: 'string', description: 'Workspace folder containing the Genie space' },
    createTime: { type: 'string', description: 'When the Genie space was created' },
    updateTime: { type: 'string', description: 'When the Genie space was last modified' },
    serializedSpace: {
      type: 'string',
      description: 'Serialized Genie space configuration (JSON string)',
    },
    // Genie (agent mode)
    responseId: { type: 'string', description: 'Genie agent response ID' },
    report: { type: 'string', description: "Genie agent's final report" },
    queries: { type: 'json', description: 'SQL the Genie agent ran ([{callId, title, sql}])' },
    items: {
      type: 'json',
      description:
        'Genie agent items ([{type, id, status, role, text, callId, name, arguments, output}])',
    },
    createdAt: {
      type: 'number',
      description: 'When the Genie agent response was created (Unix epoch seconds)',
    },
    firstId: { type: 'string', description: 'First Genie agent item ID in the page' },
    lastId: { type: 'string', description: 'Last Genie agent item ID in the page' },
  },
}

export const DatabricksBlockMeta = {
  tags: ['data-warehouse', 'data-analytics', 'cloud'],
  url: 'https://www.databricks.com',
  templates: [
    {
      icon: DatabricksIcon,
      title: 'Databricks job runner',
      prompt:
        'Build a scheduled workflow that triggers a Databricks job daily, polls until completion, writes the run status and metrics to a control table, and pages on failure.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'sync'],
      alsoIntegrations: ['pagerduty'],
    },
    {
      icon: DatabricksIcon,
      title: 'Databricks cluster cost guard',
      prompt:
        'Create a scheduled workflow that lists Databricks clusters hourly, flags clusters that are running while idle, and posts a Slack alert with the candidates to shut down so the platform team can reclaim spend.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'devops'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: DatabricksIcon,
      title: 'Databricks notebook scheduler',
      prompt:
        'Build a workflow that runs a parameterized Databricks notebook, captures the outputs as files, and posts the result to a chosen Slack channel for review.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'engineering',
      tags: ['analysis', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: DatabricksIcon,
      title: 'Databricks ML feature freshness',
      prompt:
        'Create a scheduled workflow that runs SQL against Databricks feature tables to check the latest update timestamp per feature, alerts when a critical feature has stale data, and writes the alert details to a tracking table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'monitoring'],
    },
    {
      icon: DatabricksIcon,
      title: 'Databricks model evaluator',
      prompt:
        'Build a workflow that runs a Databricks ML model evaluation job on the latest data, captures the metrics, writes results to a model-registry table, and pings Slack on regression.',
      modules: ['agent', 'tables', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'analysis'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: DatabricksIcon,
      title: 'Databricks Delta Lake compactor',
      prompt:
        'Create a scheduled workflow that runs OPTIMIZE and VACUUM on Databricks Delta Lake tables weekly, captures the size and performance delta, and writes a maintenance report.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'automation'],
    },
    {
      icon: DatabricksIcon,
      title: 'Databricks job failure watcher',
      prompt:
        'Build a workflow that lists recent Databricks job runs every 15 minutes, detects failed runs, pulls the run output and error for an agent to summarize the likely cause, and posts an actionable Slack alert with a link to the run.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring', 'engineering'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: DatabricksIcon,
      title: 'Databricks Genie Slack analyst',
      prompt:
        'Build an agent that answers data questions asked in a Slack channel with Databricks Genie. It keeps one Genie conversation per Slack thread in a table so follow-up questions keep their context, then replies in the thread with the answer, a short table of the result rows, and the SQL Genie ran.',
      modules: ['agent', 'tables', 'workflows'],
      category: 'operations',
      tags: ['analysis', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: DatabricksIcon,
      title: 'Databricks Genie space router',
      prompt:
        'Create an agent that lists the Databricks Genie spaces I can access, picks the space whose title and description best fit each incoming question, asks that Genie space, and posts the answer to Slack with which space answered it.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['analysis', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: DatabricksIcon,
      title: 'Databricks Genie KPI digest',
      prompt:
        "Build a scheduled workflow that asks a Databricks Genie agent every Monday for a research report on last week's key business metrics and what drove them, then posts the report and the SQL behind it to a Slack channel.",
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['reporting', 'analysis'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'run-sql-query',
      description:
        'Execute a SQL query against a Databricks SQL warehouse and return the results in a clean, summarized form.',
      content:
        '# Run a Databricks SQL Query\n\nQuery a table or view and summarize the result.\n\n## Steps\n1. Confirm the SQL warehouse and the query to run.\n2. Execute the SQL statement and wait for it to complete.\n3. Capture the returned rows and column schema.\n4. Summarize key findings (counts, totals, notable values).\n\n## Output\nThe query results plus a short plain-English summary of what they show.',
    },
    {
      name: 'trigger-job-run',
      description:
        'Trigger a Databricks job, capture the run id, and confirm it started successfully.',
      content:
        '# Trigger a Databricks Job\n\nKick off a job and confirm it launched.\n\n## Steps\n1. List jobs to confirm the target job id and name.\n2. Run the job with any required parameters.\n3. Capture the run id and starting state.\n\n## Output\nA confirmation with the job name, run id, and initial status.',
    },
    {
      name: 'monitor-job-run',
      description:
        'Check the status of a Databricks job run, pull its output, and diagnose failures.',
      content:
        '# Monitor a Databricks Job Run\n\nTrack a job run to completion and report results.\n\n## Steps\n1. Get the run for the given run id and read its lifecycle and result state.\n2. If still running, report progress; if finished, pull the run output.\n3. On failure, capture the error and the failing task.\n\n## Output\nA run summary with final state, key output, and (on failure) the error and failing task.',
    },
    {
      name: 'ask-genie',
      description:
        'Ask a Databricks Genie space a data question and report the answer, result rows, and generated SQL.',
      content:
        '# Ask Databricks Genie\n\nAnswer a business question from governed data through Genie.\n\n## Steps\n1. If the Genie space is unknown, list Genie spaces and pick the one whose title and description fit the question.\n2. Ask Genie the question, passing the conversation ID when this is a follow-up.\n3. If Genie asked a clarifying follow-up question instead of answering, surface it to the user.\n4. Otherwise capture the answer, the result rows, and the SQL Genie ran.\n\n## Output\nThe answer in plain English, a compact table of the key rows, the SQL, and the conversation ID for follow-ups.',
    },
    {
      name: 'research-with-genie-agent',
      description:
        'Run a multi-step Databricks Genie agent-mode investigation and summarize its report.',
      content:
        '# Research with a Genie Agent\n\nUse Genie agent mode for open-ended questions that need several queries.\n\n## Steps\n1. Ask the Genie agent the research question, continuing the conversation ID for follow-ups.\n2. Read the final report and the SQL queries the agent ran.\n3. List the conversation items if the reasoning or intermediate results are needed.\n\n## Output\nThe report summary, the key findings, and the queries behind them.',
    },
  ],
} as const satisfies BlockMeta
