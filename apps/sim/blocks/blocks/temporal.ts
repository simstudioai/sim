import { TemporalIcon } from '@/components/icons'
import { TemporalBlockDisplay } from '@/blocks/blocks/temporal.display'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import type { TemporalResponse } from '@/tools/temporal/types'

/** Coerces a subBlock value to a finite number, returning undefined for empty or non-numeric input. */
function toFiniteNumber(value: unknown): number | undefined {
  if (value == null || value === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

const WORKFLOW_ID_OPERATIONS = [
  'start_workflow',
  'signal_workflow',
  'signal_with_start',
  'query_workflow',
  'update_workflow',
  'describe_workflow',
  'get_workflow_history',
  'cancel_workflow',
  'terminate_workflow',
  'reset_workflow',
  'create_schedule',
]

const RUN_ID_OPERATIONS = [
  'signal_workflow',
  'query_workflow',
  'update_workflow',
  'describe_workflow',
  'get_workflow_history',
  'cancel_workflow',
  'terminate_workflow',
  'reset_workflow',
]

const SCHEDULE_ID_OPERATIONS = [
  'create_schedule',
  'describe_schedule',
  'pause_schedule',
  'unpause_schedule',
  'trigger_schedule',
  'delete_schedule',
]

const START_OPERATIONS = ['start_workflow', 'signal_with_start']

const WORKFLOW_TYPE_OPERATIONS = ['start_workflow', 'signal_with_start', 'create_schedule']

const TASK_QUEUE_OPERATIONS = [
  'start_workflow',
  'signal_with_start',
  'create_schedule',
  'describe_task_queue',
]

const JSON_ARGS_WAND_PROMPT = `Generate the JSON input arguments based on the user's description. A top-level array is passed as the argument list (one argument per element); any other JSON value is passed as a single argument.

Examples:
- "order 1234 for alice" -> {"orderId": "1234", "customer": "alice"}
- "two arguments: the user id 42 and the flag true" -> [42, true]

Return ONLY valid JSON - no explanations, no extra text.`

export const TemporalBlock: BlockConfig<TemporalResponse> = {
  ...TemporalBlockDisplay,
  subBlocks: [
    // ── Operation selector ─────────────────────────────────────────────────────
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Start Workflow', id: 'start_workflow' },
        { label: 'Signal Workflow', id: 'signal_workflow' },
        { label: 'Signal With Start', id: 'signal_with_start' },
        { label: 'Query Workflow', id: 'query_workflow' },
        { label: 'Update Workflow', id: 'update_workflow' },
        { label: 'Describe Workflow', id: 'describe_workflow' },
        { label: 'List Workflows', id: 'list_workflows' },
        { label: 'Count Workflows', id: 'count_workflows' },
        { label: 'Get Workflow History', id: 'get_workflow_history' },
        { label: 'Cancel Workflow', id: 'cancel_workflow' },
        { label: 'Terminate Workflow', id: 'terminate_workflow' },
        { label: 'Reset Workflow', id: 'reset_workflow' },
        { label: 'Describe Task Queue', id: 'describe_task_queue' },
        { label: 'Create Schedule', id: 'create_schedule' },
        { label: 'List Schedules', id: 'list_schedules' },
        { label: 'Describe Schedule', id: 'describe_schedule' },
        { label: 'Pause Schedule', id: 'pause_schedule' },
        { label: 'Unpause Schedule', id: 'unpause_schedule' },
        { label: 'Trigger Schedule', id: 'trigger_schedule' },
        { label: 'Delete Schedule', id: 'delete_schedule' },
      ],
      value: () => 'start_workflow',
    },

    // ── Workflow ID (all operations except list) ───────────────────────────────
    {
      id: 'workflowId',
      title: 'Workflow ID',
      type: 'short-input',
      placeholder: 'e.g., order-1234',
      condition: { field: 'operation', value: WORKFLOW_ID_OPERATIONS },
      required: { field: 'operation', value: WORKFLOW_ID_OPERATIONS },
    },

    // ── Start Workflow / Signal With Start / Create Schedule ───────────────────
    {
      id: 'workflowType',
      title: 'Workflow Type',
      type: 'short-input',
      placeholder: 'e.g., OrderWorkflow',
      condition: { field: 'operation', value: WORKFLOW_TYPE_OPERATIONS },
      required: { field: 'operation', value: WORKFLOW_TYPE_OPERATIONS },
    },
    {
      id: 'taskQueue',
      title: 'Task Queue',
      type: 'short-input',
      placeholder: 'e.g., orders',
      condition: { field: 'operation', value: TASK_QUEUE_OPERATIONS },
      required: { field: 'operation', value: TASK_QUEUE_OPERATIONS },
    },
    {
      id: 'input',
      title: 'Workflow Input',
      type: 'code',
      placeholder: '{"orderId": "1234"}  or  ["arg1", "arg2"]',
      condition: { field: 'operation', value: WORKFLOW_TYPE_OPERATIONS },
      wandConfig: {
        enabled: true,
        prompt: JSON_ARGS_WAND_PROMPT,
        placeholder: 'Describe the workflow input...',
        generationType: 'json-object',
      },
    },

    // ── Signal Workflow / Signal With Start ────────────────────────────────────
    {
      id: 'signalName',
      title: 'Signal Name',
      type: 'short-input',
      placeholder: 'e.g., approve-order',
      condition: { field: 'operation', value: ['signal_workflow', 'signal_with_start'] },
      required: { field: 'operation', value: ['signal_workflow', 'signal_with_start'] },
    },
    {
      id: 'signalInput',
      title: 'Signal Input',
      type: 'code',
      placeholder: '{"approvedBy": "alice"}',
      condition: { field: 'operation', value: ['signal_workflow', 'signal_with_start'] },
      wandConfig: {
        enabled: true,
        prompt: JSON_ARGS_WAND_PROMPT,
        placeholder: 'Describe the signal input...',
        generationType: 'json-object',
      },
    },

    // ── Query Workflow ─────────────────────────────────────────────────────────
    {
      id: 'queryType',
      title: 'Query Type',
      type: 'short-input',
      placeholder: 'e.g., getStatus',
      condition: { field: 'operation', value: 'query_workflow' },
      required: { field: 'operation', value: 'query_workflow' },
    },
    {
      id: 'queryArgs',
      title: 'Query Arguments',
      type: 'code',
      placeholder: '{"includeDetails": true}',
      condition: { field: 'operation', value: 'query_workflow' },
      wandConfig: {
        enabled: true,
        prompt: JSON_ARGS_WAND_PROMPT,
        placeholder: 'Describe the query arguments...',
        generationType: 'json-object',
      },
    },

    // ── Update Workflow ────────────────────────────────────────────────────────
    {
      id: 'updateName',
      title: 'Update Name',
      type: 'short-input',
      placeholder: 'e.g., addItem',
      condition: { field: 'operation', value: 'update_workflow' },
      required: { field: 'operation', value: 'update_workflow' },
    },
    {
      id: 'updateArgs',
      title: 'Update Arguments',
      type: 'code',
      placeholder: '{"sku": "ABC123"}',
      condition: { field: 'operation', value: 'update_workflow' },
      wandConfig: {
        enabled: true,
        prompt: JSON_ARGS_WAND_PROMPT,
        placeholder: 'Describe the update arguments...',
        generationType: 'json-object',
      },
    },

    // ── List / Count Workflows ─────────────────────────────────────────────────
    {
      id: 'listQuery',
      title: 'Query Filter',
      type: 'long-input',
      placeholder: 'e.g., WorkflowType = "OrderWorkflow" AND ExecutionStatus = "Running"',
      condition: { field: 'operation', value: ['list_workflows', 'count_workflows'] },
      wandConfig: {
        enabled: true,
        prompt: `Generate a Temporal visibility list filter based on the user's description.

The filter uses a SQL-like syntax over search attributes. Common attributes: WorkflowId, WorkflowType, ExecutionStatus (Running, Completed, Failed, Canceled, Terminated, ContinuedAsNew, TimedOut), StartTime, CloseTime, TaskQueue. String values are double-quoted; times are ISO 8601 strings.

Examples:
- "running order workflows" -> WorkflowType = "OrderWorkflow" AND ExecutionStatus = "Running"
- "failed workflows since June 1 2026" -> ExecutionStatus = "Failed" AND StartTime > "2026-06-01T00:00:00Z"
- "count by status" (count operation only) -> GROUP BY ExecutionStatus

Return ONLY the filter expression - no explanations, no extra text.`,
        placeholder: 'Describe which executions to list...',
      },
    },
    {
      id: 'pageSize',
      title: 'Page Size',
      type: 'short-input',
      placeholder: '20',
      condition: { field: 'operation', value: 'list_workflows' },
      mode: 'advanced',
    },
    {
      id: 'nextPageToken',
      title: 'Next Page Token',
      type: 'short-input',
      placeholder: 'Token from a previous response (for pagination)',
      condition: { field: 'operation', value: 'list_workflows' },
      mode: 'advanced',
    },

    // ── Get Workflow History ───────────────────────────────────────────────────
    {
      id: 'historyEventFilterType',
      title: 'Event Filter',
      type: 'dropdown',
      options: [
        { label: 'All Events', id: '' },
        { label: 'Close Event Only', id: 'HISTORY_EVENT_FILTER_TYPE_CLOSE_EVENT' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'get_workflow_history' },
      mode: 'advanced',
    },
    {
      id: 'historyPageSize',
      title: 'Page Size',
      type: 'short-input',
      placeholder: '100',
      condition: { field: 'operation', value: 'get_workflow_history' },
      mode: 'advanced',
    },
    {
      id: 'historyNextPageToken',
      title: 'Next Page Token',
      type: 'short-input',
      placeholder: 'Token from a previous response (for pagination)',
      condition: { field: 'operation', value: 'get_workflow_history' },
      mode: 'advanced',
    },

    // ── Reset Workflow ─────────────────────────────────────────────────────────
    {
      id: 'workflowTaskFinishEventId',
      title: 'Reset Event ID',
      type: 'short-input',
      placeholder: 'Workflow task event ID to reset to, e.g. a WORKFLOW_TASK_COMPLETED event',
      condition: { field: 'operation', value: 'reset_workflow' },
      required: { field: 'operation', value: 'reset_workflow' },
    },

    // ── Schedule operations ────────────────────────────────────────────────────
    {
      id: 'scheduleId',
      title: 'Schedule ID',
      type: 'short-input',
      placeholder: 'e.g., nightly-report',
      condition: { field: 'operation', value: SCHEDULE_ID_OPERATIONS },
      required: { field: 'operation', value: SCHEDULE_ID_OPERATIONS },
    },
    {
      id: 'scheduleCronExpressions',
      title: 'Cron Expressions',
      type: 'short-input',
      placeholder: 'e.g., 0 12 * * *  (comma-separated for multiple)',
      condition: { field: 'operation', value: 'create_schedule' },
      wandConfig: {
        enabled: true,
        prompt: `Generate cron expression(s) for a Temporal schedule based on the user's description. Use standard 5-field cron syntax (minute hour day-of-month month day-of-week). Separate multiple expressions with commas.

Examples:
- "every day at noon" -> 0 12 * * *
- "weekdays at 9am and 5pm" -> 0 9 * * 1-5, 0 17 * * 1-5

Return ONLY the cron expression(s) - no explanations, no extra text.`,
        placeholder: 'Describe when the schedule should fire...',
      },
    },
    {
      id: 'scheduleIntervalSeconds',
      title: 'Interval (s)',
      type: 'short-input',
      placeholder: 'Fixed interval between actions, e.g. 3600 (optional)',
      condition: { field: 'operation', value: 'create_schedule' },
      mode: 'advanced',
    },
    {
      id: 'scheduleTimezone',
      title: 'Time Zone',
      type: 'short-input',
      placeholder: 'e.g., America/New_York (defaults to UTC)',
      condition: { field: 'operation', value: 'create_schedule' },
      mode: 'advanced',
    },
    {
      id: 'scheduleNotes',
      title: 'Notes',
      type: 'short-input',
      placeholder: 'Human-readable notes for the schedule (optional)',
      condition: { field: 'operation', value: 'create_schedule' },
      mode: 'advanced',
    },
    {
      id: 'schedulePaused',
      title: 'Initial State',
      type: 'dropdown',
      options: [
        { label: 'Active', id: '' },
        { label: 'Paused', id: 'true' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'create_schedule' },
      mode: 'advanced',
    },
    {
      id: 'scheduleQuery',
      title: 'Query Filter',
      type: 'long-input',
      placeholder: 'e.g., TemporalSchedulePaused = false (optional)',
      condition: { field: 'operation', value: 'list_schedules' },
      mode: 'advanced',
    },
    {
      id: 'schedulePageSize',
      title: 'Page Size',
      type: 'short-input',
      placeholder: '20',
      condition: { field: 'operation', value: 'list_schedules' },
      mode: 'advanced',
    },
    {
      id: 'scheduleNextPageToken',
      title: 'Next Page Token',
      type: 'short-input',
      placeholder: 'Token from a previous response (for pagination)',
      condition: { field: 'operation', value: 'list_schedules' },
      mode: 'advanced',
    },
    {
      id: 'overlapPolicy',
      title: 'Overlap Policy',
      type: 'dropdown',
      options: [
        { label: 'Schedule Default', id: '' },
        { label: 'Skip', id: 'SCHEDULE_OVERLAP_POLICY_SKIP' },
        { label: 'Buffer One', id: 'SCHEDULE_OVERLAP_POLICY_BUFFER_ONE' },
        { label: 'Buffer All', id: 'SCHEDULE_OVERLAP_POLICY_BUFFER_ALL' },
        { label: 'Cancel Other', id: 'SCHEDULE_OVERLAP_POLICY_CANCEL_OTHER' },
        { label: 'Terminate Other', id: 'SCHEDULE_OVERLAP_POLICY_TERMINATE_OTHER' },
        { label: 'Allow All', id: 'SCHEDULE_OVERLAP_POLICY_ALLOW_ALL' },
      ],
      value: () => '',
      condition: { field: 'operation', value: ['trigger_schedule', 'create_schedule'] },
      mode: 'advanced',
    },

    // ── Describe Task Queue ────────────────────────────────────────────────────
    {
      id: 'taskQueueType',
      title: 'Task Queue Type',
      type: 'dropdown',
      options: [
        { label: 'Workflow', id: '' },
        { label: 'Activity', id: 'TASK_QUEUE_TYPE_ACTIVITY' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'describe_task_queue' },
      mode: 'advanced',
    },

    // ── Reason (cancel / terminate / reset / pause / unpause) ──────────────────
    {
      id: 'reason',
      title: 'Reason',
      type: 'short-input',
      placeholder: 'Recorded in the workflow history or schedule notes (optional)',
      condition: {
        field: 'operation',
        value: [
          'cancel_workflow',
          'terminate_workflow',
          'reset_workflow',
          'pause_schedule',
          'unpause_schedule',
        ],
      },
    },

    // ── Shared advanced options ────────────────────────────────────────────────
    {
      id: 'runId',
      title: 'Run ID',
      type: 'short-input',
      placeholder: 'Targets a specific run (defaults to the latest run)',
      condition: { field: 'operation', value: RUN_ID_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'workflowIdReusePolicy',
      title: 'ID Reuse Policy',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: 'Allow Duplicate', id: 'WORKFLOW_ID_REUSE_POLICY_ALLOW_DUPLICATE' },
        {
          label: 'Allow Duplicate Failed Only',
          id: 'WORKFLOW_ID_REUSE_POLICY_ALLOW_DUPLICATE_FAILED_ONLY',
        },
        { label: 'Reject Duplicate', id: 'WORKFLOW_ID_REUSE_POLICY_REJECT_DUPLICATE' },
        { label: 'Terminate If Running', id: 'WORKFLOW_ID_REUSE_POLICY_TERMINATE_IF_RUNNING' },
      ],
      value: () => '',
      condition: { field: 'operation', value: START_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'workflowIdConflictPolicy',
      title: 'ID Conflict Policy',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: 'Fail', id: 'WORKFLOW_ID_CONFLICT_POLICY_FAIL' },
        { label: 'Use Existing', id: 'WORKFLOW_ID_CONFLICT_POLICY_USE_EXISTING' },
        { label: 'Terminate Existing', id: 'WORKFLOW_ID_CONFLICT_POLICY_TERMINATE_EXISTING' },
      ],
      value: () => '',
      condition: { field: 'operation', value: START_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'cronSchedule',
      title: 'Cron Schedule',
      type: 'short-input',
      placeholder: 'e.g., 0 12 * * *',
      condition: { field: 'operation', value: START_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'executionTimeoutSeconds',
      title: 'Execution Timeout (s)',
      type: 'short-input',
      placeholder: 'Total timeout including retries (optional)',
      condition: { field: 'operation', value: START_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'runTimeoutSeconds',
      title: 'Run Timeout (s)',
      type: 'short-input',
      placeholder: 'Timeout for a single run (optional)',
      condition: { field: 'operation', value: START_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'memo',
      title: 'Memo',
      type: 'code',
      placeholder: '{"team": "payments"}',
      condition: { field: 'operation', value: START_OPERATIONS },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON object of Temporal memo fields based on the user's description.

Example: "owned by the payments team, priority high" -> {"team": "payments", "priority": "high"}

Return ONLY a valid JSON object - no explanations, no extra text.`,
        placeholder: 'Describe the memo fields...',
        generationType: 'json-object',
      },
    },
    {
      id: 'searchAttributes',
      title: 'Search Attributes',
      type: 'code',
      placeholder: '{"CustomerId": "cust-42"}',
      condition: { field: 'operation', value: START_OPERATIONS },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON object of Temporal search attribute values based on the user's description. Keys must be search attributes registered on the namespace.

Example: "customer cust-42, region us-east" -> {"CustomerId": "cust-42", "Region": "us-east"}

Return ONLY a valid JSON object - no explanations, no extra text.`,
        placeholder: 'Describe the search attributes...',
        generationType: 'json-object',
      },
    },

    // ── Connection (common to all operations) ──────────────────────────────────
    {
      id: 'serverUrl',
      title: 'Server URL',
      type: 'short-input',
      placeholder: "http://localhost:7243  (the Temporal server's HTTP API)",
      required: true,
    },
    {
      id: 'namespace',
      title: 'Namespace',
      type: 'short-input',
      placeholder: 'e.g., default',
      required: true,
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Bearer token (leave blank for servers without auth)',
      password: true,
    },
  ],

  tools: {
    access: [
      'temporal_start_workflow',
      'temporal_signal_workflow',
      'temporal_signal_with_start',
      'temporal_query_workflow',
      'temporal_update_workflow',
      'temporal_describe_workflow',
      'temporal_list_workflows',
      'temporal_count_workflows',
      'temporal_get_workflow_history',
      'temporal_cancel_workflow',
      'temporal_terminate_workflow',
      'temporal_reset_workflow',
      'temporal_describe_task_queue',
      'temporal_create_schedule',
      'temporal_list_schedules',
      'temporal_describe_schedule',
      'temporal_pause_schedule',
      'temporal_unpause_schedule',
      'temporal_trigger_schedule',
      'temporal_delete_schedule',
    ],
    config: {
      tool: (params) => `temporal_${params.operation}`,
      params: (params) => {
        const result: Record<string, unknown> = {}

        // start_workflow / signal_with_start: coerce timeouts, drop empty policies
        if (params.operation === 'start_workflow' || params.operation === 'signal_with_start') {
          result.executionTimeoutSeconds = toFiniteNumber(params.executionTimeoutSeconds)
          result.runTimeoutSeconds = toFiniteNumber(params.runTimeoutSeconds)
          if (!params.workflowIdReusePolicy) result.workflowIdReusePolicy = undefined
          if (!params.workflowIdConflictPolicy) result.workflowIdConflictPolicy = undefined
        }

        // list_workflows / count_workflows: remap listQuery → query
        if (params.operation === 'list_workflows' || params.operation === 'count_workflows') {
          result.query = params.listQuery || undefined
        }

        // list_workflows: coerce page size
        if (params.operation === 'list_workflows') {
          result.pageSize = toFiniteNumber(params.pageSize)
        }

        // get_workflow_history: remap history-prefixed fields, drop empty filter
        if (params.operation === 'get_workflow_history') {
          result.maximumPageSize = toFiniteNumber(params.historyPageSize)
          result.nextPageToken = params.historyNextPageToken || undefined
          if (!params.historyEventFilterType) result.historyEventFilterType = undefined
        }

        // reset_workflow: coerce the reset point event ID
        if (params.operation === 'reset_workflow') {
          result.workflowTaskFinishEventId = toFiniteNumber(params.workflowTaskFinishEventId)
        }

        // create_schedule: remap schedule-prefixed fields, coerce interval and paused state
        if (params.operation === 'create_schedule') {
          result.cronExpressions = params.scheduleCronExpressions || undefined
          result.intervalSeconds = toFiniteNumber(params.scheduleIntervalSeconds)
          result.timezone = params.scheduleTimezone || undefined
          result.notes = params.scheduleNotes || undefined
          result.paused = params.schedulePaused === 'true' ? true : undefined
        }

        // list_schedules: remap schedule-prefixed fields
        if (params.operation === 'list_schedules') {
          result.query = params.scheduleQuery || undefined
          result.maximumPageSize = toFiniteNumber(params.schedulePageSize)
          result.nextPageToken = params.scheduleNextPageToken || undefined
        }

        // trigger_schedule / create_schedule: drop empty overlap policy
        if (
          (params.operation === 'trigger_schedule' || params.operation === 'create_schedule') &&
          !params.overlapPolicy
        ) {
          result.overlapPolicy = undefined
        }

        // describe_task_queue: drop empty task queue type
        if (params.operation === 'describe_task_queue' && !params.taskQueueType) {
          result.taskQueueType = undefined
        }

        return result
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    serverUrl: { type: 'string', description: "Base URL of the Temporal server's HTTP API" },
    namespace: { type: 'string', description: 'Temporal namespace' },
    apiKey: {
      type: 'string',
      description: 'API key sent as a Bearer token (optional for servers without auth)',
    },
    workflowId: { type: 'string', description: 'Workflow ID of the execution' },
    runId: { type: 'string', description: 'Run ID targeting a specific run' },
    // Start Workflow / Signal With Start
    workflowType: { type: 'string', description: 'Workflow type name to run' },
    taskQueue: { type: 'string', description: 'Task queue the workflow worker polls' },
    input: { type: 'string', description: 'Workflow input as JSON' },
    workflowIdReusePolicy: {
      type: 'string',
      description: 'Policy for reusing a closed workflow ID',
    },
    workflowIdConflictPolicy: {
      type: 'string',
      description: 'Policy when a workflow with the same ID is already running',
    },
    cronSchedule: { type: 'string', description: 'Cron schedule for recurring executions' },
    executionTimeoutSeconds: {
      type: 'number',
      description: 'Total workflow execution timeout in seconds',
    },
    runTimeoutSeconds: { type: 'number', description: 'Single-run timeout in seconds' },
    memo: { type: 'string', description: 'JSON object of memo fields' },
    searchAttributes: { type: 'string', description: 'JSON object of search attribute values' },
    // Signal
    signalName: { type: 'string', description: 'Name of the signal handler to invoke' },
    signalInput: { type: 'string', description: 'Signal input as JSON' },
    // Query
    queryType: { type: 'string', description: 'Name of the query handler to invoke' },
    queryArgs: { type: 'string', description: 'Query arguments as JSON' },
    // Update
    updateName: { type: 'string', description: 'Name of the update handler to invoke' },
    updateArgs: { type: 'string', description: 'Update arguments as JSON' },
    // List / Count Workflows
    listQuery: { type: 'string', description: 'Visibility filter expression' },
    pageSize: { type: 'number', description: 'Maximum executions to return per page' },
    nextPageToken: { type: 'string', description: 'Page token for list pagination' },
    // Get Workflow History
    historyEventFilterType: {
      type: 'string',
      description: 'History event filter (all events or close event only)',
    },
    historyPageSize: { type: 'number', description: 'Maximum history events to return per page' },
    historyNextPageToken: { type: 'string', description: 'Page token for history pagination' },
    // Reset
    workflowTaskFinishEventId: {
      type: 'number',
      description: 'WORKFLOW_TASK_COMPLETED event ID to reset to',
    },
    // Schedules
    scheduleId: { type: 'string', description: 'Schedule ID' },
    scheduleCronExpressions: {
      type: 'string',
      description: 'Cron expressions for a new schedule (comma- or newline-separated)',
    },
    scheduleIntervalSeconds: {
      type: 'number',
      description: 'Fixed interval between schedule actions in seconds',
    },
    scheduleTimezone: { type: 'string', description: 'IANA time zone for cron evaluation' },
    scheduleNotes: { type: 'string', description: 'Notes stored on a new schedule' },
    schedulePaused: {
      type: 'string',
      description: 'Whether a new schedule starts paused ("true") or active (empty)',
    },
    scheduleQuery: { type: 'string', description: 'Visibility filter over schedules' },
    schedulePageSize: { type: 'number', description: 'Maximum schedules to return per page' },
    scheduleNextPageToken: { type: 'string', description: 'Page token for schedule pagination' },
    overlapPolicy: {
      type: 'string',
      description: 'Overlap policy for triggered or scheduled actions',
    },
    // Task queues
    taskQueueType: {
      type: 'string',
      description: 'Type of pollers to list (workflow or activity)',
    },
    // Cancel / Terminate / Reset / Pause / Unpause
    reason: {
      type: 'string',
      description: 'Reason recorded in the workflow history or schedule notes',
    },
  },

  outputs: {
    // Start / Signal With Start
    workflowId: { type: 'string', description: 'Workflow ID of the execution' },
    runId: { type: 'string', description: 'Run ID of the execution' },
    started: { type: 'boolean', description: 'Whether a new execution was started' },
    // Signal
    signalName: { type: 'string', description: 'Name of the signal that was sent' },
    // Query / Update
    queryType: { type: 'string', description: 'Name of the query that was run' },
    updateName: { type: 'string', description: 'Name of the update that was invoked' },
    result: { type: 'json', description: 'Decoded query or update result' },
    // Describe / List
    workflowType: { type: 'string', description: 'Workflow type name' },
    status: {
      type: 'string',
      description:
        'Execution status (RUNNING, COMPLETED, FAILED, CANCELED, TERMINATED, CONTINUED_AS_NEW, or TIMED_OUT)',
    },
    startTime: { type: 'string', description: 'Start time of the execution (RFC 3339)' },
    closeTime: { type: 'string', description: 'Close time of the execution (RFC 3339)' },
    executionTime: { type: 'string', description: 'Effective execution start time (RFC 3339)' },
    historyLength: { type: 'number', description: 'Number of events in the workflow history' },
    taskQueue: { type: 'string', description: 'Task queue of the execution' },
    memo: { type: 'json', description: 'Decoded memo fields attached to the execution' },
    searchAttributes: { type: 'json', description: 'Decoded search attribute values' },
    pendingActivities: {
      type: 'json',
      description:
        'Pending activities (activityId, activityType, state, attempt, lastFailureMessage)',
    },
    executions: {
      type: 'json',
      description:
        'Workflow executions matching the list filter (workflowId, runId, workflowType, status, startTime, closeTime, executionTime, historyLength, taskQueue)',
    },
    // Count Workflows
    count: { type: 'number', description: 'Number of workflow executions matching the query' },
    groups: {
      type: 'json',
      description: 'Per-group counts when the count query uses GROUP BY',
    },
    // Get Workflow History
    events: {
      type: 'json',
      description: 'History events (eventId, eventTime, eventType, attributes)',
    },
    nextPageToken: {
      type: 'string',
      description: 'Token for the next page of results (list and history operations)',
    },
    // Schedules
    scheduleId: { type: 'string', description: 'Schedule ID' },
    schedules: {
      type: 'json',
      description: 'Schedules (scheduleId, workflowType, paused, notes, futureActionTimes)',
    },
    paused: { type: 'boolean', description: 'Whether the schedule is paused' },
    notes: { type: 'string', description: 'Human-readable notes on the schedule' },
    spec: {
      type: 'json',
      description: 'Schedule spec (calendars, intervals, cron strings, jitter, time zone)',
    },
    recentActions: {
      type: 'json',
      description: 'Recent schedule actions (scheduleTime, actualTime, workflowId, runId)',
    },
    futureActionTimes: { type: 'json', description: 'Upcoming schedule action times (RFC 3339)' },
    // Describe Task Queue
    pollers: {
      type: 'json',
      description: 'Workers polling the task queue (identity, lastAccessTime, ratePerSecond)',
    },
  },
}

export const TemporalBlockMeta = {
  tags: ['automation'],
  url: 'https://temporal.io',
  templates: [
    {
      icon: TemporalIcon,
      title: 'Temporal order approval gate',
      prompt:
        'Create a workflow that receives an approval decision from a form, signals the matching Temporal order workflow with the decision, and posts a confirmation to Slack with the workflow ID and current status.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['automation', 'approvals'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: TemporalIcon,
      title: 'Temporal failed workflow digest',
      prompt:
        'Build a scheduled daily workflow that lists Temporal executions that failed or timed out in the last 24 hours, pulls the close event from each history to extract the failure, and posts a digest to Slack grouped by workflow type.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: TemporalIcon,
      title: 'Temporal stuck workflow watcher',
      prompt:
        'Create a scheduled workflow that lists running Temporal executions, describes each one to inspect pending activities, flags workflows whose activities are retrying with high attempt counts, and opens a Linear ticket with the failure details.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring'],
      alsoIntegrations: ['linear'],
    },
    {
      icon: TemporalIcon,
      title: 'Temporal kickoff from intake form',
      prompt:
        'Build a workflow that starts a Temporal workflow execution with input assembled from an intake form submission, polls describe until the execution closes, and writes the final status and timing to a tracking table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['automation'],
    },
    {
      icon: TemporalIcon,
      title: 'Temporal status lookup agent',
      prompt:
        'Create an agent that answers "where is my order" questions by querying the matching Temporal workflow for its current state and summarizing the progress, falling back to the latest history events when no query handler responds.',
      modules: ['agent'],
      category: 'support',
      tags: ['customer-support'],
    },
    {
      icon: TemporalIcon,
      title: 'Temporal runaway workflow janitor',
      prompt:
        'Build a scheduled weekly workflow that lists Temporal executions running longer than seven days, describes each to confirm it is stalled, requests cancellation with a recorded reason, and terminates any execution that ignores the cancellation after a grace period.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'automation'],
    },
    {
      icon: TemporalIcon,
      title: 'Temporal incident escalation bridge',
      prompt:
        'Create a workflow that signals a Temporal incident-response workflow with escalation details when a monitoring alert fires, using signal-with-start so a new incident workflow is created if one is not already running.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['incident-management', 'automation'],
      alsoIntegrations: ['pagerduty'],
    },
  ],
  skills: [
    {
      name: 'start-workflow-execution',
      description:
        'Start a Temporal workflow execution with the right input and report the workflow and run IDs.',
      content:
        '# Start a Temporal Workflow\n\nKick off a workflow execution on the cluster.\n\n## Steps\n1. Confirm the workflow type, task queue, and a unique workflow ID.\n2. Assemble the JSON input arguments for the workflow.\n3. Start the workflow and capture the run ID.\n4. Describe the execution to confirm it is running.\n\n## Output\nA confirmation with the workflow ID, run ID, and initial status.',
    },
    {
      name: 'investigate-failed-workflow',
      description:
        'Describe a failed Temporal workflow and pull its close event to explain why it failed.',
      content:
        '# Investigate a Failed Temporal Workflow\n\nDiagnose a workflow failure.\n\n## Steps\n1. Describe the workflow to confirm its status and timing.\n2. Fetch the history filtered to the close event to get the failure details.\n3. If needed, fetch earlier history pages to trace the failing activity.\n4. Summarize the root cause.\n\n## Output\nA failure summary with the failing event, error message, and a recommendation.',
    },
    {
      name: 'signal-running-workflow',
      description: 'Send a signal to a running Temporal workflow and confirm it was delivered.',
      content:
        '# Signal a Temporal Workflow\n\nDeliver data or a decision to a running execution.\n\n## Steps\n1. Find the target execution by workflow ID (or list executions to locate it).\n2. Send the signal with the JSON payload.\n3. Query or describe the workflow to confirm the signal took effect.\n\n## Output\nA confirmation with the workflow ID, signal name, and resulting state.',
    },
    {
      name: 'audit-running-workflows',
      description: 'List running Temporal executions and surface long-running or stuck workflows.',
      content:
        '# Audit Running Temporal Workflows\n\nFind executions that need attention.\n\n## Steps\n1. List executions filtered to ExecutionStatus = "Running".\n2. Sort by start time and flag the longest-running executions.\n3. Describe flagged executions to inspect pending activities and retry counts.\n4. Recommend cancellation or escalation for stuck workflows.\n\n## Output\nA per-workflow report with age, pending activities, and a recommended action.',
    },
  ],
} as const satisfies BlockMeta
