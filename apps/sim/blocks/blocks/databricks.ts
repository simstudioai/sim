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
    'Execute parameterized SQL and retrieve result chunks, create and manage jobs, submit and repair runs, manage compute clusters and SQL warehouses, and create or update Genie spaces. Ask Genie questions or run agent research, inspect conversations, and retrieve query results and charts. Connect with a personal access token and workspace host URL.',
  docsLink: 'https://docs.sim.ai/integrations/databricks',
  category: 'tools',
  integrationType: IntegrationType.Databases,
  bgColor: '#F9F7F4',
  icon: DatabricksIcon,
  canvasPresentation: {
    defaultTitle: 'Databricks',
    sentences: {
      byOperation: {
        genie_agent_cancel: [{ text: 'Cancel genie agent response', field: 'spaceId', core: true }],

        get_statement_chunk: [{ text: 'Get statement chunk', field: 'statementId', core: true }],

        cancel_statement: [{ text: 'Cancel statement', field: 'statementId', core: true }],

        get_warehouse: [{ text: 'Get warehouse', field: 'warehouseId', core: true }],

        genie_delete_space: [{ text: 'Trash genie space', field: 'spaceId', core: true }],

        genie_update_space: [{ text: 'Update genie space', field: 'spaceId', core: true }],

        genie_create_space: [{ text: 'Create genie space', field: 'warehouseId', core: true }],

        delete_warehouse: [{ text: 'Delete warehouse', field: 'warehouseId', core: true }],

        stop_warehouse: [{ text: 'Stop warehouse', field: 'warehouseId', core: true }],

        start_warehouse: [{ text: 'Start warehouse', field: 'warehouseId', core: true }],

        edit_warehouse: [{ text: 'Edit warehouse', field: 'warehouseId', core: true }],

        create_warehouse: [{ text: 'Create warehouse', field: 'name', core: true }],

        delete_cluster: [{ text: 'Delete cluster', field: 'clusterId', core: true }],

        resize_cluster: [{ text: 'Resize cluster', field: 'clusterId', core: true }],

        terminate_cluster: [{ text: 'Terminate cluster', field: 'clusterId', core: true }],

        restart_cluster: [{ text: 'Restart cluster', field: 'clusterId', core: true }],

        start_cluster: [{ text: 'Start cluster', field: 'clusterId', core: true }],

        edit_cluster: [{ text: 'Edit cluster', field: 'clusterId', core: true }],

        create_cluster: [{ text: 'Create cluster', field: 'clusterName', core: true }],

        cancel_all_runs: ['Cancel all runs'],

        delete_run: [{ text: 'Delete run', field: 'runId', core: true }],

        repair_run: [{ text: 'Repair run', field: 'runId', core: true }],

        submit_run: [{ text: 'Submit run', field: 'runName', core: true }],

        delete_job: [{ text: 'Delete job', field: 'jobId', core: true }],

        reset_job: [{ text: 'Reset job', field: 'jobId', core: true }],

        update_job: [{ text: 'Update job', field: 'jobId', core: true }],

        create_job: [{ text: 'Create job', field: 'name', core: true }],

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
        { label: 'Get Statement Chunk', id: 'get_statement_chunk' },
        { label: 'Cancel Statement', id: 'cancel_statement' },
        { label: 'List Jobs', id: 'list_jobs' },
        { label: 'Get Job', id: 'get_job' },
        { label: 'Create Job', id: 'create_job' },
        { label: 'Update Job', id: 'update_job' },
        { label: 'Reset Job', id: 'reset_job' },
        { label: 'Delete Job', id: 'delete_job' },
        { label: 'Run Job', id: 'run_job' },
        { label: 'Submit Run', id: 'submit_run' },
        { label: 'List Runs', id: 'list_runs' },
        { label: 'Get Run', id: 'get_run' },
        { label: 'Get Run Output', id: 'get_run_output' },
        { label: 'Repair Run', id: 'repair_run' },
        { label: 'Cancel Run', id: 'cancel_run' },
        { label: 'Cancel All Runs', id: 'cancel_all_runs' },
        { label: 'Delete Run', id: 'delete_run' },
        { label: 'List Clusters', id: 'list_clusters' },
        { label: 'Get Cluster', id: 'get_cluster' },
        { label: 'Create Cluster', id: 'create_cluster' },
        { label: 'Edit Cluster', id: 'edit_cluster' },
        { label: 'Start Cluster', id: 'start_cluster' },
        { label: 'Restart Cluster', id: 'restart_cluster' },
        { label: 'Resize Cluster', id: 'resize_cluster' },
        { label: 'Terminate Cluster', id: 'terminate_cluster' },
        { label: 'Delete Cluster', id: 'delete_cluster' },
        { label: 'List Warehouses', id: 'list_warehouses' },
        { label: 'Get Warehouse', id: 'get_warehouse' },
        { label: 'Create Warehouse', id: 'create_warehouse' },
        { label: 'Edit Warehouse', id: 'edit_warehouse' },
        { label: 'Start Warehouse', id: 'start_warehouse' },
        { label: 'Stop Warehouse', id: 'stop_warehouse' },
        { label: 'Delete Warehouse', id: 'delete_warehouse' },
        { label: 'List Genie Spaces', id: 'genie_list_spaces' },
        { label: 'Get Genie Space', id: 'genie_get_space' },
        { label: 'Create Genie Space', id: 'genie_create_space' },
        { label: 'Update Genie Space', id: 'genie_update_space' },
        { label: 'Trash Genie Space', id: 'genie_delete_space' },
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
        { label: 'Ask Genie Agent', id: 'genie_agent_ask' },
        { label: 'List Genie Agent Items', id: 'genie_agent_list_items' },
        { label: 'Cancel Genie Agent Response', id: 'genie_agent_cancel' },
      ],
      value: () => 'execute_sql',
    },

    {
      id: 'warehouseId',
      title: 'Warehouse ID',
      type: 'short-input',
      placeholder: 'Enter SQL warehouse ID',
      condition: {
        field: 'operation',
        value: [
          'execute_sql',
          'edit_warehouse',
          'start_warehouse',
          'stop_warehouse',
          'delete_warehouse',
          'genie_create_space',
          'genie_update_space',
          'get_warehouse',
          'cancel_statement',
          'get_statement_chunk',
          'get_statement',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'execute_sql',
          'edit_warehouse',
          'start_warehouse',
          'stop_warehouse',
          'delete_warehouse',
          'genie_create_space',
          'get_warehouse',
        ],
      },
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

    {
      id: 'statementId',
      title: 'Statement ID',
      type: 'short-input',
      placeholder: 'Enter the statement ID',
      condition: {
        field: 'operation',
        value: ['get_statement', 'cancel_statement', 'get_statement_chunk'],
      },
      required: {
        field: 'operation',
        value: ['get_statement', 'cancel_statement', 'get_statement_chunk'],
      },
    },

    {
      id: 'name',
      title: 'Name',
      type: 'short-input',
      placeholder: 'Resource name, or exact job name filter',
      condition: {
        field: 'operation',
        value: ['list_jobs', 'create_job', 'create_warehouse', 'edit_warehouse'],
      },
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
      condition: { field: 'operation', value: ['list_jobs', 'list_runs'] },
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

    {
      id: 'jobId',
      title: 'Job ID',
      type: 'short-input',
      placeholder: 'Enter the job ID',
      condition: {
        field: 'operation',
        value: [
          'run_job',
          'list_runs',
          'get_job',
          'update_job',
          'reset_job',
          'delete_job',
          'cancel_all_runs',
        ],
      },
      required: {
        field: 'operation',
        value: ['run_job', 'get_job', 'update_job', 'reset_job', 'delete_job'],
      },
    },
    {
      id: 'jobParameters',
      title: 'Job Parameters',
      type: 'code',
      placeholder: '{"key": "value"}',
      condition: { field: 'operation', value: ['run_job', 'repair_run'] },
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
      condition: { field: 'operation', value: ['run_job', 'submit_run'] },
      mode: 'advanced',
    },

    {
      id: 'runId',
      title: 'Run ID',
      type: 'short-input',
      placeholder: 'Enter the run ID',
      condition: {
        field: 'operation',
        value: ['get_run', 'cancel_run', 'get_run_output', 'repair_run', 'delete_run'],
      },
      required: {
        field: 'operation',
        value: ['get_run', 'cancel_run', 'get_run_output', 'repair_run', 'delete_run'],
      },
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

    {
      id: 'clusterId',
      title: 'Cluster ID',
      type: 'short-input',
      placeholder: 'Enter the cluster ID',
      condition: {
        field: 'operation',
        value: [
          'get_cluster',
          'edit_cluster',
          'start_cluster',
          'restart_cluster',
          'terminate_cluster',
          'resize_cluster',
          'delete_cluster',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'get_cluster',
          'edit_cluster',
          'start_cluster',
          'restart_cluster',
          'terminate_cluster',
          'resize_cluster',
          'delete_cluster',
        ],
      },
    },

    {
      id: 'spaceId',
      title: 'Genie Space ID',
      type: 'short-input',
      placeholder: 'Enter the Genie space (agent) ID',
      condition: {
        field: 'operation',
        value: [
          ...GENIE_SPACE_OPERATIONS,
          'genie_update_space',
          'genie_delete_space',
          'genie_agent_cancel',
        ],
      },
      required: {
        field: 'operation',
        value: [
          ...GENIE_SPACE_OPERATIONS,
          'genie_update_space',
          'genie_delete_space',
          'genie_agent_cancel',
        ],
      },
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
        value: [...GENIE_ASK_OPERATIONS, ...GENIE_CONVERSATION_OPERATIONS, 'genie_agent_cancel'],
      },
      required: {
        field: 'operation',
        value: [...GENIE_CONVERSATION_OPERATIONS, 'genie_agent_cancel'],
      },
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
      condition: {
        field: 'operation',
        value: [...GENIE_PAGED_OPERATIONS, 'list_clusters', 'list_warehouses'],
      },
      mode: 'advanced',
    },
    {
      id: 'pageToken',
      title: 'Page Token',
      type: 'short-input',
      placeholder: 'nextPageToken from a previous call',
      condition: {
        field: 'operation',
        value: [
          ...GENIE_PAGED_OPERATIONS,
          'list_jobs',
          'list_runs',
          'get_job',
          'get_run',
          'list_clusters',
          'list_warehouses',
        ],
      },
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

    {
      id: 'accessControlList',
      title: 'Access Control List',
      type: 'code',
      condition: { field: 'operation', value: ['create_job', 'submit_run'] },
      mode: 'advanced',
      placeholder: '[]',
      language: 'json',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate Databricks Access Control List using API field names. Initial permissions as [{user_name, group_name, service_principal_name, permission_level}]. Return ONLY the JSON array.',
        placeholder: 'Describe access control list',
      },
    },
    {
      id: 'description',
      title: 'Description',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['create_job', 'genie_create_space', 'genie_update_space'],
      },
      mode: 'advanced',
      placeholder: 'Description of the job or Genie space',
    },
    {
      id: 'emailNotifications',
      title: 'Email Notifications',
      type: 'code',
      condition: { field: 'operation', value: ['create_job', 'submit_run'] },
      mode: 'advanced',
      placeholder: '{"key": "value"}',
      language: 'json',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate Databricks Email Notifications using API field names. Email recipients by event, such as {on_failure: ["ops@example.com"]}. Return ONLY the JSON object.',
        placeholder: 'Describe email notifications',
      },
    },
    {
      id: 'webhookNotifications',
      title: 'Webhook Notifications',
      type: 'code',
      condition: { field: 'operation', value: ['create_job', 'submit_run'] },
      mode: 'advanced',
      placeholder: '{"key": "value"}',
      language: 'json',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate Databricks Webhook Notifications using API field names. Notification destination IDs grouped by event. Return ONLY the JSON object.',
        placeholder: 'Describe webhook notifications',
      },
    },
    {
      id: 'notificationSettings',
      title: 'Notification Settings',
      type: 'code',
      condition: { field: 'operation', value: ['create_job', 'submit_run'] },
      mode: 'advanced',
      placeholder: '{"key": "value"}',
      language: 'json',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate Databricks Notification Settings using API field names. Notification preferences for skipped runs, canceled runs, and retries. Return ONLY the JSON object.',
        placeholder: 'Describe notification settings',
      },
    },
    {
      id: 'timeoutSeconds',
      title: 'Timeout Seconds',
      type: 'short-input',
      condition: { field: 'operation', value: ['create_job', 'submit_run'] },
      mode: 'advanced',
      placeholder: 'Maximum run duration in seconds; 0 disables the timeout',
    },
    {
      id: 'health',
      title: 'Health',
      type: 'code',
      condition: { field: 'operation', value: ['create_job', 'submit_run'] },
      mode: 'advanced',
      placeholder: '{"key": "value"}',
      language: 'json',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate Databricks Health using API field names. Health rules as {rules: [{metric, op, value}]}. Return ONLY the JSON object.',
        placeholder: 'Describe health',
      },
    },
    {
      id: 'schedule',
      title: 'Schedule',
      type: 'code',
      condition: { field: 'operation', value: ['create_job'] },
      mode: 'advanced',
      placeholder: '{"key": "value"}',
      language: 'json',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate Databricks Schedule using API field names. Quartz schedule as {quartz_cron_expression, timezone_id, pause_status}. Return ONLY the JSON object.',
        placeholder: 'Describe schedule',
      },
    },
    {
      id: 'jobTrigger',
      title: 'Job Trigger',
      type: 'code',
      condition: { field: 'operation', value: ['create_job'] },
      mode: 'advanced',
      placeholder: '{"key": "value"}',
      language: 'json',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate Databricks Job Trigger using API field names. Job trigger settings in Databricks API format. Return ONLY the JSON object.',
        placeholder: 'Describe job trigger',
      },
    },
    {
      id: 'continuous',
      title: 'Continuous',
      type: 'code',
      condition: { field: 'operation', value: ['create_job'] },
      mode: 'advanced',
      placeholder: '{"key": "value"}',
      language: 'json',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate Databricks Continuous using API field names. Continuous execution settings; mutually exclusive with schedule. Return ONLY the JSON object.',
        placeholder: 'Describe continuous',
      },
    },
    {
      id: 'maxConcurrentRuns',
      title: 'Max Concurrent Runs',
      type: 'short-input',
      condition: { field: 'operation', value: ['create_job'] },
      mode: 'advanced',
      placeholder: 'Maximum simultaneous runs allowed for this job',
    },
    {
      id: 'tasks',
      title: 'Tasks',
      type: 'code',
      condition: { field: 'operation', value: ['create_job', 'submit_run'] },
      placeholder: '[]',
      language: 'json',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate Databricks Tasks using API field names. Task definitions using Databricks API fields, including task_key, depends_on, and notebook_task or other task types. Return ONLY the JSON array.',
        placeholder: 'Describe tasks',
      },
    },
    {
      id: 'jobClusters',
      title: 'Job Clusters',
      type: 'code',
      condition: { field: 'operation', value: ['create_job'] },
      mode: 'advanced',
      placeholder: '[]',
      language: 'json',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate Databricks Job Clusters using API field names. Shared job clusters as [{job_cluster_key, new_cluster}]. Return ONLY the JSON array.',
        placeholder: 'Describe job clusters',
      },
    },
    {
      id: 'gitSource',
      title: 'Git Source',
      type: 'code',
      condition: { field: 'operation', value: ['create_job', 'submit_run'] },
      mode: 'advanced',
      placeholder: '{"key": "value"}',
      language: 'json',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate Databricks Git Source using API field names. Git repository URL, provider, and branch, tag, or commit. Return ONLY the JSON object.',
        placeholder: 'Describe git source',
      },
    },
    {
      id: 'tags',
      title: 'Tags',
      type: 'code',
      condition: { field: 'operation', value: ['create_job'] },
      mode: 'advanced',
      placeholder: '{"key": "value"}',
      language: 'json',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate Databricks Tags using API field names. Job tags as a JSON object of string keys and values. Return ONLY the JSON object.',
        placeholder: 'Describe tags',
      },
    },
    {
      id: 'queue',
      title: 'Queue',
      type: 'code',
      condition: { field: 'operation', value: ['create_job', 'submit_run', 'run_job'] },
      mode: 'advanced',
      placeholder: '{"key": "value"}',
      language: 'json',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate Databricks Queue using API field names. Queue behavior as {enabled: true} or {enabled: false}. Return ONLY the JSON object.',
        placeholder: 'Describe queue',
      },
    },
    {
      id: 'parameters',
      title: 'Parameters',
      type: 'code',
      condition: { field: 'operation', value: ['create_job'] },
      mode: 'advanced',
      placeholder: '[]',
      language: 'json',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate Databricks Parameters using API field names. Job parameter definitions as [{name, default}]. Return ONLY the JSON array.',
        placeholder: 'Describe parameters',
      },
    },
    {
      id: 'runAs',
      title: 'Run As',
      type: 'code',
      condition: { field: 'operation', value: ['create_job', 'submit_run'] },
      mode: 'advanced',
      placeholder: '{"key": "value"}',
      language: 'json',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate Databricks Run As using API field names. Execution identity as {user_name} or {service_principal_name}. Return ONLY the JSON object.',
        placeholder: 'Describe run as',
      },
    },
    {
      id: 'editMode',
      title: 'Edit Mode',
      type: 'dropdown',
      condition: { field: 'operation', value: ['create_job'] },
      mode: 'advanced',
      options: [
        { label: 'Default', id: '' },
        { label: 'UI_LOCKED', id: 'UI_LOCKED' },
        { label: 'EDITABLE', id: 'EDITABLE' },
      ],
      value: () => '',
    },
    {
      id: 'deployment',
      title: 'Deployment',
      type: 'code',
      condition: { field: 'operation', value: ['create_job'] },
      mode: 'advanced',
      placeholder: '{"key": "value"}',
      language: 'json',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate Databricks Deployment using API field names. External deployment metadata including kind and metadata_file_path. Return ONLY the JSON object.',
        placeholder: 'Describe deployment',
      },
    },
    {
      id: 'environments',
      title: 'Environments',
      type: 'code',
      condition: { field: 'operation', value: ['create_job', 'submit_run'] },
      mode: 'advanced',
      placeholder: '[]',
      language: 'json',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate Databricks Environments using API field names. Task environments as [{environment_key, spec}]. Return ONLY the JSON array.',
        placeholder: 'Describe environments',
      },
    },
    {
      id: 'budgetPolicyId',
      title: 'Budget Policy ID',
      type: 'short-input',
      condition: { field: 'operation', value: ['create_job', 'submit_run'] },
      mode: 'advanced',
      placeholder: 'Serverless budget policy identifier',
    },
    {
      id: 'performanceTarget',
      title: 'Performance Target',
      type: 'dropdown',
      condition: {
        field: 'operation',
        value: ['create_job', 'submit_run', 'repair_run', 'run_job'],
      },
      mode: 'advanced',
      options: [
        { label: 'Default', id: '' },
        { label: 'PERFORMANCE_OPTIMIZED', id: 'PERFORMANCE_OPTIMIZED' },
        { label: 'STANDARD', id: 'STANDARD' },
      ],
      value: () => '',
    },
    {
      id: 'triggers',
      title: 'Triggers',
      type: 'code',
      condition: { field: 'operation', value: ['create_job'] },
      mode: 'advanced',
      placeholder: '[]',
      language: 'json',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate Databricks Triggers using API field names. Job trigger definitions; cannot be combined with the singular trigger setting. Return ONLY the JSON array.',
        placeholder: 'Describe triggers',
      },
    },
    {
      id: 'environmentVariables',
      title: 'Environment Variables',
      type: 'code',
      condition: { field: 'operation', value: ['create_job', 'submit_run'] },
      mode: 'advanced',
      placeholder: '[]',
      language: 'json',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate Databricks Environment Variables using API field names. Named environment variable definitions in Databricks API format. Return ONLY the JSON array.',
        placeholder: 'Describe environment variables',
      },
    },
    {
      id: 'maxRetries',
      title: 'Max Retries',
      type: 'short-input',
      condition: { field: 'operation', value: ['create_job'] },
      mode: 'advanced',
      placeholder: 'Maximum retry count; -1 retries indefinitely and 0 disables retries',
    },
    {
      id: 'minRetryIntervalMillis',
      title: 'Min Retry Interval Millis',
      type: 'short-input',
      condition: { field: 'operation', value: ['create_job'] },
      mode: 'advanced',
      placeholder: 'Minimum time in milliseconds between attempts',
    },
    {
      id: 'retryOnTimeout',
      title: 'Retry On Timeout',
      type: 'dropdown',
      condition: { field: 'operation', value: ['create_job'] },
      mode: 'advanced',
      options: [
        { label: 'Default', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
    },
    {
      id: 'disableAutoOptimization',
      title: 'Disable Auto Optimization',
      type: 'dropdown',
      condition: { field: 'operation', value: ['create_job'] },
      mode: 'advanced',
      options: [
        { label: 'Default', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
    },
    {
      id: 'newSettings',
      title: 'New Settings',
      type: 'code',
      condition: { field: 'operation', value: ['update_job', 'reset_job'] },
      required: { field: 'operation', value: ['reset_job'] },
      placeholder: '{"key": "value"}',
      language: 'json',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate Databricks New Settings using API field names. Job settings in Databricks API format; Update merges top-level fields and task keys, Reset replaces all settings. Return ONLY the JSON object.',
        placeholder: 'Describe new settings',
      },
    },
    {
      id: 'fieldsToRemove',
      title: 'Fields To Remove',
      type: 'code',
      condition: { field: 'operation', value: ['update_job'] },
      mode: 'advanced',
      placeholder: '[]',
      language: 'json',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate Databricks Fields To Remove using API field names. Settings to remove, such as ["schedule", "tasks/task_key"]. Return ONLY the JSON array.',
        placeholder: 'Describe fields to remove',
      },
    },
    {
      id: 'runName',
      title: 'Run Name',
      type: 'short-input',
      condition: { field: 'operation', value: ['submit_run'] },
      placeholder: 'Display name of the one-time run',
    },
    {
      id: 'latestRepairId',
      title: 'Latest Repair ID',
      type: 'short-input',
      condition: { field: 'operation', value: ['repair_run'] },
      mode: 'advanced',
      placeholder: 'Most recent repair ID; required after the first repair of a run',
    },
    {
      id: 'rerunTasks',
      title: 'Rerun Tasks',
      type: 'code',
      condition: { field: 'operation', value: ['repair_run'] },
      mode: 'advanced',
      placeholder: '[]',
      language: 'json',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate Databricks Rerun Tasks using API field names. Task keys to repair; mutually exclusive with rerunAllFailedTasks. Return ONLY the JSON array.',
        placeholder: 'Describe rerun tasks',
      },
    },
    {
      id: 'rerunAllFailedTasks',
      title: 'Rerun All Failed Tasks',
      type: 'dropdown',
      condition: { field: 'operation', value: ['repair_run'] },
      mode: 'advanced',
      options: [
        { label: 'Default', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
    },
    {
      id: 'rerunDependentTasks',
      title: 'Rerun Dependent Tasks',
      type: 'dropdown',
      condition: { field: 'operation', value: ['repair_run'] },
      mode: 'advanced',
      options: [
        { label: 'Default', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
    },
    {
      id: 'pipelineParams',
      title: 'Pipeline Params',
      type: 'code',
      condition: { field: 'operation', value: ['repair_run', 'run_job'] },
      mode: 'advanced',
      placeholder: '{"key": "value"}',
      language: 'json',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate Databricks Pipeline Params using API field names. Pipeline refresh settings, including full_refresh and selective table or flow lists. Return ONLY the JSON object.',
        placeholder: 'Describe pipeline params',
      },
    },
    {
      id: 'allQueuedRuns',
      title: 'All Queued Runs',
      type: 'dropdown',
      condition: { field: 'operation', value: ['cancel_all_runs'] },
      mode: 'advanced',
      options: [
        { label: 'Default', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
    },
    {
      id: 'applyPolicyDefaultValues',
      title: 'Apply Policy Default Values',
      type: 'dropdown',
      condition: { field: 'operation', value: ['create_cluster', 'edit_cluster'] },
      mode: 'advanced',
      options: [
        { label: 'Default', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
    },
    {
      id: 'cloneFrom',
      title: 'Clone From',
      type: 'code',
      condition: { field: 'operation', value: ['create_cluster'] },
      mode: 'advanced',
      placeholder: '{"key": "value"}',
      language: 'json',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate Databricks Clone From using API field names. Clone source as {source_cluster_id, clone_source}. Return ONLY the JSON object.',
        placeholder: 'Describe clone from',
      },
    },
    {
      id: 'numWorkers',
      title: 'Num Workers',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['create_cluster', 'edit_cluster', 'resize_cluster'],
      },
      placeholder: 'Fixed worker count; use this or autoscale',
    },
    {
      id: 'autoscale',
      title: 'Autoscale',
      type: 'code',
      condition: {
        field: 'operation',
        value: ['create_cluster', 'edit_cluster', 'resize_cluster'],
      },
      placeholder: '{"key": "value"}',
      language: 'json',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate Databricks Autoscale using API field names. Worker range as {min_workers, max_workers}; use this or numWorkers. Return ONLY the JSON object.',
        placeholder: 'Describe autoscale',
      },
    },
    {
      id: 'clusterName',
      title: 'Cluster Name',
      type: 'short-input',
      condition: { field: 'operation', value: ['create_cluster', 'edit_cluster'] },
      placeholder: 'Display name of the compute cluster',
    },
    {
      id: 'sparkVersion',
      title: 'Spark Version',
      type: 'short-input',
      condition: { field: 'operation', value: ['create_cluster', 'edit_cluster'] },
      placeholder: 'Databricks runtime version, or omit when supplied by a compute policy',
    },
    {
      id: 'sparkConf',
      title: 'Spark Conf',
      type: 'code',
      condition: { field: 'operation', value: ['create_cluster', 'edit_cluster'] },
      mode: 'advanced',
      placeholder: '{"key": "value"}',
      language: 'json',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate Databricks Spark Conf using API field names. Spark configuration as a JSON map. Return ONLY the JSON object.',
        placeholder: 'Describe spark conf',
      },
    },
    {
      id: 'awsAttributes',
      title: 'Aws Attributes',
      type: 'code',
      condition: { field: 'operation', value: ['create_cluster', 'edit_cluster'] },
      mode: 'advanced',
      placeholder: '{"key": "value"}',
      language: 'json',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate Databricks Aws Attributes using API field names. AWS compute configuration such as availability, zone_id, and instance_profile_arn. Return ONLY the JSON object.',
        placeholder: 'Describe aws attributes',
      },
    },
    {
      id: 'azureAttributes',
      title: 'Azure Attributes',
      type: 'code',
      condition: { field: 'operation', value: ['create_cluster', 'edit_cluster'] },
      mode: 'advanced',
      placeholder: '{"key": "value"}',
      language: 'json',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate Databricks Azure Attributes using API field names. Azure compute configuration such as availability and spot_bid_max_price. Return ONLY the JSON object.',
        placeholder: 'Describe azure attributes',
      },
    },
    {
      id: 'gcpAttributes',
      title: 'Gcp Attributes',
      type: 'code',
      condition: { field: 'operation', value: ['create_cluster', 'edit_cluster'] },
      mode: 'advanced',
      placeholder: '{"key": "value"}',
      language: 'json',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate Databricks Gcp Attributes using API field names. GCP compute configuration such as availability and zone_id. Return ONLY the JSON object.',
        placeholder: 'Describe gcp attributes',
      },
    },
    {
      id: 'nodeTypeId',
      title: 'Node Type ID',
      type: 'short-input',
      condition: { field: 'operation', value: ['create_cluster', 'edit_cluster'] },
      placeholder: 'Worker node type identifier',
    },
    {
      id: 'driverNodeTypeId',
      title: 'Driver Node Type ID',
      type: 'short-input',
      condition: { field: 'operation', value: ['create_cluster', 'edit_cluster'] },
      mode: 'advanced',
      placeholder: 'Driver node type identifier',
    },
    {
      id: 'workerNodeTypeFlexibility',
      title: 'Worker Node Type Flexibility',
      type: 'code',
      condition: { field: 'operation', value: ['create_cluster', 'edit_cluster'] },
      mode: 'advanced',
      placeholder: '{"key": "value"}',
      language: 'json',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate Databricks Worker Node Type Flexibility using API field names. Alternative worker node type selection settings. Return ONLY the JSON object.',
        placeholder: 'Describe worker node type flexibility',
      },
    },
    {
      id: 'driverNodeTypeFlexibility',
      title: 'Driver Node Type Flexibility',
      type: 'code',
      condition: { field: 'operation', value: ['create_cluster', 'edit_cluster'] },
      mode: 'advanced',
      placeholder: '{"key": "value"}',
      language: 'json',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate Databricks Driver Node Type Flexibility using API field names. Alternative driver node type selection settings. Return ONLY the JSON object.',
        placeholder: 'Describe driver node type flexibility',
      },
    },
    {
      id: 'sshPublicKeys',
      title: 'Ssh Public Keys',
      type: 'code',
      condition: { field: 'operation', value: ['create_cluster', 'edit_cluster'] },
      mode: 'advanced',
      placeholder: '[]',
      language: 'json',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate Databricks Ssh Public Keys using API field names. SSH public keys to install on the cluster. Return ONLY the JSON array.',
        placeholder: 'Describe ssh public keys',
      },
    },
    {
      id: 'customTags',
      title: 'Custom Tags',
      type: 'code',
      condition: { field: 'operation', value: ['create_cluster', 'edit_cluster'] },
      mode: 'advanced',
      placeholder: '{"key": "value"}',
      language: 'json',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate Databricks Custom Tags using API field names. Custom cluster tags as a JSON map. Return ONLY the JSON object.',
        placeholder: 'Describe custom tags',
      },
    },
    {
      id: 'clusterLogConf',
      title: 'Cluster Log Conf',
      type: 'code',
      condition: { field: 'operation', value: ['create_cluster', 'edit_cluster'] },
      mode: 'advanced',
      placeholder: '{"key": "value"}',
      language: 'json',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate Databricks Cluster Log Conf using API field names. Cluster log destination in Databricks API format. Return ONLY the JSON object.',
        placeholder: 'Describe cluster log conf',
      },
    },
    {
      id: 'sparkEnvVars',
      title: 'Spark Env Vars',
      type: 'code',
      condition: { field: 'operation', value: ['create_cluster', 'edit_cluster'] },
      mode: 'advanced',
      placeholder: '{"key": "value"}',
      language: 'json',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate Databricks Spark Env Vars using API field names. Environment variables for the Spark processes as a JSON map. Return ONLY the JSON object.',
        placeholder: 'Describe spark env vars',
      },
    },
    {
      id: 'autoterminationMinutes',
      title: 'Autotermination Minutes',
      type: 'short-input',
      condition: { field: 'operation', value: ['create_cluster', 'edit_cluster'] },
      mode: 'advanced',
      placeholder: 'Idle minutes before termination; 0 disables automatic termination',
    },
    {
      id: 'enableElasticDisk',
      title: 'Enable Elastic Disk',
      type: 'dropdown',
      condition: { field: 'operation', value: ['create_cluster', 'edit_cluster'] },
      mode: 'advanced',
      options: [
        { label: 'Default', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
    },
    {
      id: 'initScripts',
      title: 'Init Scripts',
      type: 'code',
      condition: { field: 'operation', value: ['create_cluster', 'edit_cluster'] },
      mode: 'advanced',
      placeholder: '[]',
      language: 'json',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate Databricks Init Scripts using API field names. Cluster initialization script locations in Databricks API format. Return ONLY the JSON array.',
        placeholder: 'Describe init scripts',
      },
    },
    {
      id: 'dockerImage',
      title: 'Docker Image',
      type: 'code',
      condition: { field: 'operation', value: ['create_cluster', 'edit_cluster'] },
      mode: 'advanced',
      placeholder: '{"key": "value"}',
      language: 'json',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate Databricks Docker Image using API field names. Custom container image URL and optional basic_auth settings. Return ONLY the JSON object.',
        placeholder: 'Describe docker image',
      },
    },
    {
      id: 'instancePoolId',
      title: 'Instance Pool ID',
      type: 'short-input',
      condition: { field: 'operation', value: ['create_cluster', 'edit_cluster'] },
      mode: 'advanced',
      placeholder: 'Worker instance pool identifier',
    },
    {
      id: 'singleUserName',
      title: 'Single User Name',
      type: 'short-input',
      condition: { field: 'operation', value: ['create_cluster', 'edit_cluster'] },
      mode: 'advanced',
      placeholder: 'Assigned user or service principal for dedicated access mode',
    },
    {
      id: 'policyId',
      title: 'Policy ID',
      type: 'short-input',
      condition: { field: 'operation', value: ['create_cluster', 'edit_cluster'] },
      mode: 'advanced',
      placeholder: 'Compute policy identifier',
    },
    {
      id: 'enableLocalDiskEncryption',
      title: 'Enable Local Disk Encryption',
      type: 'dropdown',
      condition: { field: 'operation', value: ['create_cluster', 'edit_cluster'] },
      mode: 'advanced',
      options: [
        { label: 'Default', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
    },
    {
      id: 'driverInstancePoolId',
      title: 'Driver Instance Pool ID',
      type: 'short-input',
      condition: { field: 'operation', value: ['create_cluster', 'edit_cluster'] },
      mode: 'advanced',
      placeholder: 'Driver instance pool identifier',
    },
    {
      id: 'workloadType',
      title: 'Workload Type',
      type: 'code',
      condition: { field: 'operation', value: ['create_cluster', 'edit_cluster'] },
      mode: 'advanced',
      placeholder: '{"key": "value"}',
      language: 'json',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate Databricks Workload Type using API field names. Permitted workload types in Databricks API format. Return ONLY the JSON object.',
        placeholder: 'Describe workload type',
      },
    },
    {
      id: 'dataSecurityMode',
      title: 'Data Security Mode',
      type: 'dropdown',
      condition: { field: 'operation', value: ['create_cluster', 'edit_cluster'] },
      mode: 'advanced',
      options: [
        { label: 'Default', id: '' },
        { label: 'NONE', id: 'NONE' },
        { label: 'SINGLE_USER', id: 'SINGLE_USER' },
        { label: 'USER_ISOLATION', id: 'USER_ISOLATION' },
        { label: 'LEGACY_TABLE_ACL', id: 'LEGACY_TABLE_ACL' },
        { label: 'LEGACY_PASSTHROUGH', id: 'LEGACY_PASSTHROUGH' },
        { label: 'LEGACY_SINGLE_USER', id: 'LEGACY_SINGLE_USER' },
        { label: 'LEGACY_SINGLE_USER_STANDARD', id: 'LEGACY_SINGLE_USER_STANDARD' },
        { label: 'DATA_SECURITY_MODE_STANDARD', id: 'DATA_SECURITY_MODE_STANDARD' },
        { label: 'DATA_SECURITY_MODE_DEDICATED', id: 'DATA_SECURITY_MODE_DEDICATED' },
        { label: 'DATA_SECURITY_MODE_AUTO', id: 'DATA_SECURITY_MODE_AUTO' },
      ],
      value: () => '',
    },
    {
      id: 'runtimeEngine',
      title: 'Runtime Engine',
      type: 'dropdown',
      condition: { field: 'operation', value: ['create_cluster', 'edit_cluster'] },
      mode: 'advanced',
      options: [
        { label: 'Default', id: '' },
        { label: 'NULL', id: 'NULL' },
        { label: 'STANDARD', id: 'STANDARD' },
        { label: 'PHOTON', id: 'PHOTON' },
      ],
      value: () => '',
    },
    {
      id: 'kind',
      title: 'Kind',
      type: 'dropdown',
      condition: { field: 'operation', value: ['create_cluster', 'edit_cluster'] },
      mode: 'advanced',
      options: [
        { label: 'Default', id: '' },
        { label: 'CLASSIC_PREVIEW', id: 'CLASSIC_PREVIEW' },
      ],
      value: () => '',
    },
    {
      id: 'useMlRuntime',
      title: 'Use Ml Runtime',
      type: 'dropdown',
      condition: { field: 'operation', value: ['create_cluster', 'edit_cluster'] },
      mode: 'advanced',
      options: [
        { label: 'Default', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
    },
    {
      id: 'isSingleNode',
      title: 'Is Single Node',
      type: 'dropdown',
      condition: { field: 'operation', value: ['create_cluster', 'edit_cluster'] },
      mode: 'advanced',
      options: [
        { label: 'Default', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
    },
    {
      id: 'remoteDiskThroughput',
      title: 'Remote Disk Throughput',
      type: 'short-input',
      condition: { field: 'operation', value: ['create_cluster', 'edit_cluster'] },
      mode: 'advanced',
      placeholder: 'Remote disk throughput setting',
    },
    {
      id: 'totalInitialRemoteDiskSize',
      title: 'Total Initial Remote Disk Size',
      type: 'short-input',
      condition: { field: 'operation', value: ['create_cluster', 'edit_cluster'] },
      mode: 'advanced',
      placeholder: 'Initial remote disk size setting',
    },
    {
      id: 'dependencyMode',
      title: 'Dependency Mode',
      type: 'dropdown',
      condition: { field: 'operation', value: ['create_cluster', 'edit_cluster'] },
      mode: 'advanced',
      options: [
        { label: 'Default', id: '' },
        { label: 'DEPENDENCY_MODE_ENVIRONMENTS', id: 'DEPENDENCY_MODE_ENVIRONMENTS' },
        { label: 'DEPENDENCY_MODE_CLUSTER_LIBRARIES', id: 'DEPENDENCY_MODE_CLUSTER_LIBRARIES' },
        { label: 'DEPENDENCY_MODE_AUTO', id: 'DEPENDENCY_MODE_AUTO' },
      ],
      value: () => '',
    },
    {
      id: 'restartUser',
      title: 'Restart User',
      type: 'short-input',
      condition: { field: 'operation', value: ['restart_cluster'] },
      mode: 'advanced',
      placeholder: 'User requesting the cluster restart',
    },
    {
      id: 'clusterSize',
      title: 'Cluster Size',
      type: 'short-input',
      condition: { field: 'operation', value: ['create_warehouse', 'edit_warehouse'] },
      mode: 'advanced',
      placeholder: 'SQL warehouse size, such as Small or Medium',
    },
    {
      id: 'minNumClusters',
      title: 'Min Num Clusters',
      type: 'short-input',
      condition: { field: 'operation', value: ['create_warehouse', 'edit_warehouse'] },
      mode: 'advanced',
      placeholder: 'Minimum number of SQL warehouse clusters',
    },
    {
      id: 'maxNumClusters',
      title: 'Max Num Clusters',
      type: 'short-input',
      condition: { field: 'operation', value: ['create_warehouse', 'edit_warehouse'] },
      mode: 'advanced',
      placeholder: 'Maximum number of SQL warehouse clusters',
    },
    {
      id: 'autoStopMins',
      title: 'Auto Stop Mins',
      type: 'short-input',
      condition: { field: 'operation', value: ['create_warehouse', 'edit_warehouse'] },
      mode: 'advanced',
      placeholder: 'Idle minutes before stopping the warehouse; 0 disables automatic stopping',
    },
    {
      id: 'creatorName',
      title: 'Creator Name',
      type: 'short-input',
      condition: { field: 'operation', value: ['create_warehouse', 'edit_warehouse'] },
      mode: 'advanced',
      placeholder: 'Warehouse creator name',
    },
    {
      id: 'warehouseTags',
      title: 'Warehouse Tags',
      type: 'code',
      condition: { field: 'operation', value: ['create_warehouse', 'edit_warehouse'] },
      mode: 'advanced',
      placeholder: '{"key": "value"}',
      language: 'json',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate Databricks Warehouse Tags using API field names. Warehouse tags as {custom_tags: [{key, value}]}. Return ONLY the JSON object.',
        placeholder: 'Describe warehouse tags',
      },
    },
    {
      id: 'spotInstancePolicy',
      title: 'Spot Instance Policy',
      type: 'dropdown',
      condition: { field: 'operation', value: ['create_warehouse', 'edit_warehouse'] },
      mode: 'advanced',
      options: [
        { label: 'Default', id: '' },
        { label: 'POLICY_UNSPECIFIED', id: 'POLICY_UNSPECIFIED' },
        { label: 'COST_OPTIMIZED', id: 'COST_OPTIMIZED' },
        { label: 'RELIABILITY_OPTIMIZED', id: 'RELIABILITY_OPTIMIZED' },
      ],
      value: () => '',
    },
    {
      id: 'enablePhoton',
      title: 'Enable Photon',
      type: 'dropdown',
      condition: { field: 'operation', value: ['create_warehouse', 'edit_warehouse'] },
      mode: 'advanced',
      options: [
        { label: 'Default', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
    },
    {
      id: 'channel',
      title: 'Channel',
      type: 'code',
      condition: { field: 'operation', value: ['create_warehouse', 'edit_warehouse'] },
      mode: 'advanced',
      placeholder: '{"key": "value"}',
      language: 'json',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate Databricks Channel using API field names. Warehouse release channel as {name: "CHANNEL_NAME_CURRENT"}. Return ONLY the JSON object.',
        placeholder: 'Describe channel',
      },
    },
    {
      id: 'enableServerlessCompute',
      title: 'Enable Serverless Compute',
      type: 'dropdown',
      condition: { field: 'operation', value: ['create_warehouse', 'edit_warehouse'] },
      mode: 'advanced',
      options: [
        { label: 'Default', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
    },
    {
      id: 'warehouseType',
      title: 'Warehouse Type',
      type: 'dropdown',
      condition: { field: 'operation', value: ['create_warehouse', 'edit_warehouse'] },
      mode: 'advanced',
      options: [
        { label: 'Default', id: '' },
        { label: 'TYPE_UNSPECIFIED', id: 'TYPE_UNSPECIFIED' },
        { label: 'CLASSIC', id: 'CLASSIC' },
        { label: 'PRO', id: 'PRO' },
      ],
      value: () => '',
    },
    {
      id: 'statementTimeout',
      title: 'Statement Timeout',
      type: 'short-input',
      condition: { field: 'operation', value: ['create_warehouse', 'edit_warehouse'] },
      mode: 'advanced',
      placeholder: 'Warehouse statement timeout in seconds',
    },
    {
      id: 'parentPath',
      title: 'Parent Path',
      type: 'short-input',
      condition: { field: 'operation', value: ['genie_create_space', 'genie_update_space'] },
      mode: 'advanced',
      placeholder: 'Parent workspace folder for the Genie space',
    },
    {
      id: 'serializedSpace',
      title: 'Serialized Space',
      type: 'code',
      condition: { field: 'operation', value: ['genie_create_space', 'genie_update_space'] },
      required: { field: 'operation', value: ['genie_create_space'] },
      placeholder: '{"version": 2, "data_sources": {"tables": []}}',
      language: 'json',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate Databricks Serialized Space using API field names. Serialized Genie configuration JSON, including data_sources, instructions, config, and benchmarks; get an example with Get Genie Space. Return ONLY the JSON object.',
        placeholder: 'Describe serialized space',
      },
    },
    {
      id: 'title',
      title: 'Title',
      type: 'short-input',
      condition: { field: 'operation', value: ['genie_create_space', 'genie_update_space'] },
      placeholder: 'Genie space title',
    },
    {
      id: 'etag',
      title: 'Etag',
      type: 'short-input',
      condition: { field: 'operation', value: ['genie_update_space'] },
      mode: 'advanced',
      placeholder: 'Version from Get Genie Space; prevents overwriting concurrent changes',
    },
    {
      id: 'chunkIndex',
      title: 'Chunk Index',
      type: 'short-input',
      condition: { field: 'operation', value: ['get_statement_chunk'] },
      required: { field: 'operation', value: ['get_statement_chunk'] },
      placeholder: 'Zero-based SQL result chunk index',
    },
    {
      id: 'responseId',
      title: 'Response ID',
      type: 'short-input',
      condition: { field: 'operation', value: ['genie_agent_cancel'] },
      required: { field: 'operation', value: ['genie_agent_cancel'] },
      placeholder: 'Agent response ID from the response.created event',
    },
    {
      id: 'sqlParameters',
      title: 'SQL Parameters',
      type: 'code',
      condition: { field: 'operation', value: ['execute_sql'] },
      mode: 'advanced',
      placeholder: '[]',
      language: 'json',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate Databricks SQL Parameters using API field names. Named SQL parameters as [{name, value, type}]; null or omitted value represents SQL NULL. Return ONLY the JSON array.',
        placeholder: 'Describe sql parameters',
      },
    },
    {
      id: 'byteLimit',
      title: 'Byte Limit',
      type: 'short-input',
      condition: { field: 'operation', value: ['execute_sql'] },
      mode: 'advanced',
      placeholder: 'Maximum SQL result size in bytes; truncation is reported in the output',
    },
    {
      id: 'onWaitTimeout',
      title: 'On Wait Timeout',
      type: 'dropdown',
      condition: { field: 'operation', value: ['execute_sql'] },
      mode: 'advanced',
      options: [
        { label: 'Default', id: '' },
        { label: 'CONTINUE', id: 'CONTINUE' },
        { label: 'CANCEL', id: 'CANCEL' },
      ],
      value: () => '',
    },
    {
      id: 'includeTriggerState',
      title: 'Include Trigger State',
      type: 'dropdown',
      condition: { field: 'operation', value: ['get_job'] },
      mode: 'advanced',
      options: [
        { label: 'Default', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
    },
    {
      id: 'only',
      title: 'Only',
      type: 'code',
      condition: { field: 'operation', value: ['run_job'] },
      mode: 'advanced',
      placeholder: '[]',
      language: 'json',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate Databricks Only using API field names. Task keys to run; omit to run every task. Return ONLY the JSON array.',
        placeholder: 'Describe only',
      },
    },

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
      'databricks_get_statement_chunk',
      'databricks_cancel_statement',
      'databricks_list_jobs',
      'databricks_get_job',
      'databricks_create_job',
      'databricks_update_job',
      'databricks_reset_job',
      'databricks_delete_job',
      'databricks_run_job',
      'databricks_submit_run',
      'databricks_list_runs',
      'databricks_get_run',
      'databricks_get_run_output',
      'databricks_repair_run',
      'databricks_cancel_run',
      'databricks_cancel_all_runs',
      'databricks_delete_run',
      'databricks_list_clusters',
      'databricks_get_cluster',
      'databricks_create_cluster',
      'databricks_edit_cluster',
      'databricks_start_cluster',
      'databricks_restart_cluster',
      'databricks_resize_cluster',
      'databricks_terminate_cluster',
      'databricks_delete_cluster',
      'databricks_list_warehouses',
      'databricks_get_warehouse',
      'databricks_create_warehouse',
      'databricks_edit_warehouse',
      'databricks_start_warehouse',
      'databricks_stop_warehouse',
      'databricks_delete_warehouse',
      'databricks_genie_list_spaces',
      'databricks_genie_get_space',
      'databricks_genie_create_space',
      'databricks_genie_update_space',
      'databricks_genie_delete_space',
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
      'databricks_genie_agent_ask',
      'databricks_genie_agent_list_items',
      'databricks_genie_agent_cancel',
    ],
    config: {
      tool: (params) => `databricks_${params.operation}`,
      params: (params) => {
        const result: Record<string, unknown> = {}
        for (const key of [
          'autoStopMins',
          'autoterminationMinutes',
          'byteLimit',
          'chunkIndex',
          'jobId',
          'latestRepairId',
          'limit',
          'maxConcurrentRuns',
          'maxNumClusters',
          'maxRetries',
          'minNumClusters',
          'minRetryIntervalMillis',
          'numWorkers',
          'offset',
          'pageSize',
          'remoteDiskThroughput',
          'rowLimit',
          'runId',
          'startTimeFrom',
          'startTimeTo',
          'statementTimeout',
          'timeoutSeconds',
          'totalInitialRemoteDiskSize',
        ]) {
          const value = params[key]
          result[key] = value == null || value === '' ? undefined : Number(value)
        }
        for (const key of [
          'activeOnly',
          'allQueuedRuns',
          'applyPolicyDefaultValues',
          'completedOnly',
          'disableAutoOptimization',
          'enableElasticDisk',
          'enableLocalDiskEncryption',
          'enablePhoton',
          'enableServerlessCompute',
          'enableVisualization',
          'expandTasks',
          'includeAll',
          'includeHistory',
          'includeResolvedValues',
          'includeSerializedSpace',
          'includeTriggerState',
          'isSingleNode',
          'rerunAllFailedTasks',
          'rerunDependentTasks',
          'retryOnTimeout',
          'useMlRuntime',
        ]) {
          const value = params[key]
          result[key] =
            value == null || value === '' ? undefined : value === true || value === 'true'
        }
        for (const key of [
          'dataSecurityMode',
          'dependencyMode',
          'editMode',
          'kind',
          'onWaitTimeout',
          'performanceTarget',
          'runType',
          'runtimeEngine',
          'spotInstancePolicy',
          'warehouseType',
        ]) {
          if (params[key] === '') result[key] = undefined
        }
        return result
      },
    },
  },
  inputs: {
    accessControlList: {
      type: 'json',
      description:
        'Initial permissions as [{user_name, group_name, service_principal_name, permission_level}]',
    },
    description: { type: 'string', description: 'Description of the job or Genie space' },
    emailNotifications: {
      type: 'json',
      description: 'Email recipients by event, such as {on_failure: ["ops@example.com"]}',
    },
    webhookNotifications: {
      type: 'json',
      description: 'Notification destination IDs grouped by event',
    },
    notificationSettings: {
      type: 'json',
      description: 'Notification preferences for skipped runs, canceled runs, and retries',
    },
    timeoutSeconds: {
      type: 'number',
      description: 'Maximum run duration in seconds; 0 disables the timeout',
    },
    health: { type: 'json', description: 'Health rules as {rules: [{metric, op, value}]}' },
    schedule: {
      type: 'json',
      description: 'Quartz schedule as {quartz_cron_expression, timezone_id, pause_status}',
    },
    jobTrigger: { type: 'json', description: 'Job trigger settings in Databricks API format' },
    continuous: {
      type: 'json',
      description: 'Continuous execution settings; mutually exclusive with schedule',
    },
    maxConcurrentRuns: {
      type: 'number',
      description: 'Maximum simultaneous runs allowed for this job',
    },
    tasks: {
      type: 'json',
      description:
        'Task definitions using Databricks API fields, including task_key, depends_on, and notebook_task or other task types',
    },
    jobClusters: {
      type: 'json',
      description: 'Shared job clusters as [{job_cluster_key, new_cluster}]',
    },
    gitSource: {
      type: 'json',
      description: 'Git repository URL, provider, and branch, tag, or commit',
    },
    tags: { type: 'json', description: 'Job tags as a JSON object of string keys and values' },
    queue: { type: 'json', description: 'Queue behavior as {enabled: true} or {enabled: false}' },
    parameters: { type: 'json', description: 'Job parameter definitions as [{name, default}]' },
    runAs: {
      type: 'json',
      description: 'Execution identity as {user_name} or {service_principal_name}',
    },
    editMode: { type: 'string', description: 'Whether the job can be edited in the Databricks UI' },
    deployment: {
      type: 'json',
      description: 'External deployment metadata including kind and metadata_file_path',
    },
    environments: { type: 'json', description: 'Task environments as [{environment_key, spec}]' },
    budgetPolicyId: { type: 'string', description: 'Serverless budget policy identifier' },
    performanceTarget: {
      type: 'string',
      description: 'Serverless performance mode: STANDARD or PERFORMANCE_OPTIMIZED',
    },
    triggers: {
      type: 'json',
      description: 'Job trigger definitions; cannot be combined with the singular trigger setting',
    },
    environmentVariables: {
      type: 'json',
      description: 'Named environment variable definitions in Databricks API format',
    },
    maxRetries: {
      type: 'number',
      description: 'Maximum retry count; -1 retries indefinitely and 0 disables retries',
    },
    minRetryIntervalMillis: {
      type: 'number',
      description: 'Minimum time in milliseconds between attempts',
    },
    retryOnTimeout: { type: 'boolean', description: 'Whether a timed-out run should be retried' },
    disableAutoOptimization: {
      type: 'boolean',
      description: 'Disable serverless automatic optimization',
    },
    newSettings: {
      type: 'json',
      description:
        'Job settings in Databricks API format; Update merges top-level fields and task keys, Reset replaces all settings',
    },
    fieldsToRemove: {
      type: 'json',
      description: 'Settings to remove, such as ["schedule", "tasks/task_key"]',
    },
    runName: { type: 'string', description: 'Display name of the one-time run' },
    latestRepairId: {
      type: 'number',
      description: 'Most recent repair ID; required after the first repair of a run',
    },
    rerunTasks: {
      type: 'json',
      description: 'Task keys to repair; mutually exclusive with rerunAllFailedTasks',
    },
    rerunAllFailedTasks: {
      type: 'boolean',
      description: 'Repair every failed task instead of specifying task keys',
    },
    rerunDependentTasks: {
      type: 'boolean',
      description: 'Also rerun tasks downstream of the selected failed tasks',
    },
    pipelineParams: {
      type: 'json',
      description:
        'Pipeline refresh settings, including full_refresh and selective table or flow lists',
    },
    allQueuedRuns: {
      type: 'boolean',
      description: 'Cancel queued runs; without a job ID this applies to the workspace',
    },
    applyPolicyDefaultValues: {
      type: 'boolean',
      description: 'Fill unspecified settings from the compute policy defaults',
    },
    cloneFrom: { type: 'json', description: 'Clone source as {source_cluster_id, clone_source}' },
    numWorkers: { type: 'number', description: 'Fixed worker count; use this or autoscale' },
    autoscale: {
      type: 'json',
      description: 'Worker range as {min_workers, max_workers}; use this or numWorkers',
    },
    clusterName: { type: 'string', description: 'Display name of the compute cluster' },
    sparkVersion: {
      type: 'string',
      description: 'Databricks runtime version, or omit when supplied by a compute policy',
    },
    sparkConf: { type: 'json', description: 'Spark configuration as a JSON map' },
    awsAttributes: {
      type: 'json',
      description:
        'AWS compute configuration such as availability, zone_id, and instance_profile_arn',
    },
    azureAttributes: {
      type: 'json',
      description: 'Azure compute configuration such as availability and spot_bid_max_price',
    },
    gcpAttributes: {
      type: 'json',
      description: 'GCP compute configuration such as availability and zone_id',
    },
    nodeTypeId: { type: 'string', description: 'Worker node type identifier' },
    driverNodeTypeId: { type: 'string', description: 'Driver node type identifier' },
    workerNodeTypeFlexibility: {
      type: 'json',
      description: 'Alternative worker node type selection settings',
    },
    driverNodeTypeFlexibility: {
      type: 'json',
      description: 'Alternative driver node type selection settings',
    },
    sshPublicKeys: { type: 'json', description: 'SSH public keys to install on the cluster' },
    customTags: { type: 'json', description: 'Custom cluster tags as a JSON map' },
    clusterLogConf: {
      type: 'json',
      description: 'Cluster log destination in Databricks API format',
    },
    sparkEnvVars: {
      type: 'json',
      description: 'Environment variables for the Spark processes as a JSON map',
    },
    autoterminationMinutes: {
      type: 'number',
      description: 'Idle minutes before termination; 0 disables automatic termination',
    },
    enableElasticDisk: {
      type: 'boolean',
      description: 'Allow automatic expansion of attached storage',
    },
    initScripts: {
      type: 'json',
      description: 'Cluster initialization script locations in Databricks API format',
    },
    dockerImage: {
      type: 'json',
      description: 'Custom container image URL and optional basic_auth settings',
    },
    instancePoolId: { type: 'string', description: 'Worker instance pool identifier' },
    singleUserName: {
      type: 'string',
      description: 'Assigned user or service principal for dedicated access mode',
    },
    policyId: { type: 'string', description: 'Compute policy identifier' },
    enableLocalDiskEncryption: { type: 'boolean', description: 'Encrypt local cluster storage' },
    driverInstancePoolId: { type: 'string', description: 'Driver instance pool identifier' },
    workloadType: {
      type: 'json',
      description: 'Permitted workload types in Databricks API format',
    },
    dataSecurityMode: { type: 'string', description: 'Cluster access mode' },
    runtimeEngine: { type: 'string', description: 'Runtime execution engine' },
    kind: { type: 'string', description: 'Compute kind' },
    useMlRuntime: { type: 'boolean', description: 'Use a machine learning runtime' },
    isSingleNode: { type: 'boolean', description: 'Create a single-node compute resource' },
    remoteDiskThroughput: { type: 'number', description: 'Remote disk throughput setting' },
    totalInitialRemoteDiskSize: { type: 'number', description: 'Initial remote disk size setting' },
    dependencyMode: { type: 'string', description: 'Cluster dependency mode' },
    restartUser: { type: 'string', description: 'User requesting the cluster restart' },
    clusterSize: { type: 'string', description: 'SQL warehouse size, such as Small or Medium' },
    minNumClusters: { type: 'number', description: 'Minimum number of SQL warehouse clusters' },
    maxNumClusters: { type: 'number', description: 'Maximum number of SQL warehouse clusters' },
    autoStopMins: {
      type: 'number',
      description: 'Idle minutes before stopping the warehouse; 0 disables automatic stopping',
    },
    creatorName: { type: 'string', description: 'Warehouse creator name' },
    warehouseTags: { type: 'json', description: 'Warehouse tags as {custom_tags: [{key, value}]}' },
    spotInstancePolicy: {
      type: 'string',
      description: 'Cost or reliability preference for spot instances',
    },
    enablePhoton: { type: 'boolean', description: 'Enable Photon for SQL warehouse compute' },
    channel: {
      type: 'json',
      description: 'Warehouse release channel as {name: "CHANNEL_NAME_CURRENT"}',
    },
    enableServerlessCompute: {
      type: 'boolean',
      description: 'Use serverless SQL warehouse compute',
    },
    warehouseType: { type: 'string', description: 'Warehouse type; use PRO for serverless' },
    statementTimeout: { type: 'number', description: 'Warehouse statement timeout in seconds' },
    parentPath: { type: 'string', description: 'Parent workspace folder for the Genie space' },
    serializedSpace: {
      type: 'string',
      description:
        'Serialized Genie configuration JSON, including data_sources, instructions, config, and benchmarks; get an example with Get Genie Space',
    },
    title: { type: 'string', description: 'Genie space title' },
    etag: {
      type: 'string',
      description: 'Version from Get Genie Space; prevents overwriting concurrent changes',
    },
    chunkIndex: { type: 'number', description: 'Zero-based SQL result chunk index' },
    responseId: {
      type: 'string',
      description: 'Agent response ID from the response.created event',
    },
    sqlParameters: {
      type: 'json',
      description:
        'Named SQL parameters as [{name, value, type}]; null or omitted value represents SQL NULL',
    },
    byteLimit: {
      type: 'number',
      description: 'Maximum SQL result size in bytes; truncation is reported in the output',
    },
    onWaitTimeout: {
      type: 'string',
      description: 'Continue execution asynchronously or cancel when waitTimeout expires',
    },
    includeTriggerState: { type: 'boolean', description: 'Include current job trigger state' },
    only: { type: 'json', description: 'Task keys to run; omit to run every task' },

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
    jobParameters: { type: 'json', description: 'Job-level parameters as JSON' },
    notebookParams: { type: 'json', description: 'Notebook task parameters as JSON' },
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
    warehouse: {
      type: 'json',
      description: 'SQL warehouse settings (warehouseId, name, state, clusterSize, autoscaling)',
    },
    clusterId: { type: 'string', description: 'ID of a newly created compute cluster' },
    repairId: {
      type: 'number',
      description: 'Repair ID to pass as latestRepairId on the next repair',
    },
    prevPageToken: { type: 'string', description: 'Pagination token for the previous page' },
    nextChunkIndex: { type: 'number', description: 'Index of the next SQL result chunk' },
    nextChunkInternalLink: {
      type: 'string',
      description: 'Workspace-relative path to the next SQL result chunk',
    },
    chunkIndex: { type: 'number', description: 'Index of the current SQL result chunk' },
    rowOffset: { type: 'number', description: 'Starting row offset of the SQL chunk' },
    totalChunks: { type: 'number', description: 'Total SQL result chunks' },
    jobClusters: {
      type: 'json',
      description: 'Shared job compute definitions ([{job_cluster_key, new_cluster}])',
    },
    parameters: { type: 'json', description: 'Job parameter definitions ([{name, default}])' },
    queue: { type: 'json', description: 'Job queue settings (enabled)' },
    triggerState: {
      type: 'json',
      description: 'Current job trigger state (file_arrival, table)',
    },
    jobParameters: { type: 'json', description: 'Resolved run parameter values ([{name, value}])' },
    repairHistory: {
      type: 'json',
      description: 'Run repairs ([{id, type, task_run_ids, status, start_time, end_time}])',
    },
    runStatus: {
      type: 'json',
      description: 'Run status (state, termination_details, queue_details)',
    },
    runDuration: { type: 'number', description: 'Run duration including repairs in milliseconds' },
    sqlOutput: {
      type: 'json',
      description: 'SQL task results (query_output, alert_output, dashboard_output)',
    },
    dbtOutput: { type: 'json', description: 'dbt artifacts (artifacts_link, artifacts_headers)' },
    runJobOutput: { type: 'json', description: 'Child job task result (run_id)' },
    info: { type: 'string', description: 'Additional run output information' },
    etag: { type: 'string', description: 'Genie space version for conditional updates' },

    statementId: { type: 'string', description: 'Statement ID' },
    status: { type: 'string', description: 'SQL statement, Genie message, or Genie agent status' },
    columns: { type: 'json', description: 'Result column schema' },
    data: { type: 'json', description: 'Result rows as 2D array' },
    totalRows: { type: 'number', description: 'Total row count' },
    truncated: { type: 'boolean', description: 'Whether results were truncated' },

    jobs: { type: 'json', description: 'List of jobs' },
    hasMore: {
      type: 'boolean',
      description: 'Whether more results or Genie agent items are available',
    },
    nextPageToken: { type: 'string', description: 'Pagination token for next page' },

    warehouses: {
      type: 'json',
      description:
        'List of SQL warehouses ([{warehouseId, name, clusterSize, state, warehouseType, ...}])',
    },

    name: { type: 'string', description: 'Job or resource name' },
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
    tasks: {
      type: 'json',
      description: 'Job tasks or task runs ([{task_key, run_id, state, resolved_values, ...}])',
    },

    runId: { type: 'number', description: 'Triggered run ID' },
    numberInJob: { type: 'number', description: 'Run sequence number in job' },

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

    runs: { type: 'json', description: 'List of job runs' },

    success: { type: 'boolean', description: 'Whether the mutation request was accepted' },

    notebookOutput: { type: 'json', description: 'Notebook task output' },
    error: {
      type: 'string',
      description: 'Error message if the run failed or Genie could not answer',
    },
    errorTrace: { type: 'string', description: 'Error stack trace' },
    logs: { type: 'string', description: 'Run log output' },
    logsTruncated: { type: 'boolean', description: 'Whether logs were truncated' },

    clusters: { type: 'json', description: 'List of clusters' },

    cluster: {
      type: 'json',
      description: 'Cluster detail (clusterId, clusterName, state, sparkVersion, autoscale, ...)',
    },

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
    rowCount: {
      type: 'number',
      description: 'Rows in the SQL result chunk, or total rows reported by Genie',
    },
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

    spaces: {
      type: 'json',
      description: 'Genie spaces ([{spaceId, title, description, warehouseId, ...}])',
    },
    spaceId: { type: 'string', description: 'Genie space ID' },
    title: { type: 'string', description: 'Genie space title' },
    description: { type: 'string', description: 'Job or Genie space description' },
    warehouseId: { type: 'string', description: 'SQL warehouse the Genie space queries' },
    parentPath: { type: 'string', description: 'Workspace folder containing the Genie space' },
    createTime: { type: 'string', description: 'When the Genie space was created' },
    updateTime: { type: 'string', description: 'When the Genie space was last modified' },
    serializedSpace: {
      type: 'string',
      description: 'Serialized Genie space configuration (JSON string)',
    },

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
      name: 'repair-failed-tasks',
      description:
        'Repair the failed portion of a multi-task job without rerunning successful independent tasks.',
      content:
        '# Repair Failed Databricks Tasks\n\nRecover a failed job run.\n\n## Steps\n1. Get the run with repair history enabled and inspect each failed task.\n2. Retrieve output using the failing task run ID to diagnose the cause.\n3. After correcting the cause, repair selected task keys or all failed tasks, optionally including dependents.\n4. Supply the latest repair ID for subsequent repairs and poll the run for completion.\n\n## Output\nThe repair ID, affected task keys, and final run status.',
    },
    {
      name: 'configure-warehouse-scaling',
      description: 'Inspect and adjust SQL warehouse size, cluster limits, and automatic stopping.',
      content:
        '# Configure SQL Warehouse Scaling\n\nApply the requested warehouse capacity settings.\n\n## Steps\n1. Get the warehouse and inspect its current size, cluster limits, and state.\n2. Confirm the desired size, minimum and maximum cluster counts, and idle stopping policy.\n3. Edit the warehouse with the requested settings.\n4. Get the warehouse again to report the applied configuration.\n\n## Output\nThe warehouse ID and its updated capacity and automatic stopping settings.',
    },

    {
      name: 'run-sql-query',
      description:
        'Execute a SQL query against a Databricks SQL warehouse and return the results in a clean, summarized form.',
      content:
        '# Run a Databricks SQL Query\n\nQuery a table or view and summarize the result.\n\n## Steps\n1. Confirm the SQL warehouse and the query to run.\n2. Execute the SQL statement and wait for it to complete.\n3. Capture the returned rows and column schema; follow nextChunkIndex with Get Statement Chunk when more rows are needed.\n4. Summarize key findings (counts, totals, notable values).\n\n## Output\nThe query results plus a short plain-English summary of what they show.',
    },
    {
      name: 'trigger-job-run',
      description:
        'Trigger a Databricks job, capture the run id, and confirm it started successfully.',
      content:
        '# Trigger a Databricks Job\n\nKick off a job and confirm it launched.\n\n## Steps\n1. List jobs to confirm the target job id and name.\n2. Run the job with any required parameters.\n3. Capture the run id, then get the run to read its starting state.\n\n## Output\nA confirmation with the job name, run id, and initial status.',
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
