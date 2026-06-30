import { TriggerDevIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { TriggerDevResponse } from '@/tools/trigger_dev/types'

const TASK_IDENTIFIER_OPERATIONS = ['trigger_dev_trigger_task', 'trigger_dev_batch_trigger_task']
const RUN_ID_OPERATIONS = [
  'trigger_dev_get_run',
  'trigger_dev_get_run_result',
  'trigger_dev_get_run_events',
  'trigger_dev_get_run_trace',
  'trigger_dev_cancel_run',
  'trigger_dev_replay_run',
  'trigger_dev_reschedule_run',
  'trigger_dev_add_run_tags',
  'trigger_dev_update_run_metadata',
]
const BATCH_ID_OPERATIONS = ['trigger_dev_get_batch', 'trigger_dev_get_batch_results']
const ENV_VAR_OPERATIONS = [
  'trigger_dev_list_env_vars',
  'trigger_dev_create_env_var',
  'trigger_dev_get_env_var',
  'trigger_dev_update_env_var',
  'trigger_dev_delete_env_var',
  'trigger_dev_import_env_vars',
]
const ENV_VAR_NAME_OPERATIONS = [
  'trigger_dev_create_env_var',
  'trigger_dev_get_env_var',
  'trigger_dev_update_env_var',
  'trigger_dev_delete_env_var',
]
const ENV_VAR_VALUE_OPERATIONS = ['trigger_dev_create_env_var', 'trigger_dev_update_env_var']
const QUEUE_OPERATIONS = [
  'trigger_dev_get_queue',
  'trigger_dev_pause_queue',
  'trigger_dev_resume_queue',
  'trigger_dev_override_queue_concurrency',
  'trigger_dev_reset_queue_concurrency',
]
const SCHEDULE_ID_OPERATIONS = [
  'trigger_dev_get_schedule',
  'trigger_dev_update_schedule',
  'trigger_dev_delete_schedule',
  'trigger_dev_activate_schedule',
  'trigger_dev_deactivate_schedule',
]
const SCHEDULE_DEFINITION_OPERATIONS = [
  'trigger_dev_create_schedule',
  'trigger_dev_update_schedule',
]
const WAITPOINT_ID_OPERATIONS = [
  'trigger_dev_get_waitpoint_token',
  'trigger_dev_complete_waitpoint_token',
]
const IDEMPOTENCY_KEY_OPERATIONS = [
  'trigger_dev_trigger_task',
  'trigger_dev_create_waitpoint_token',
]
const TAGS_OPERATIONS = ['trigger_dev_trigger_task', 'trigger_dev_create_waitpoint_token']
const CREATED_AT_FILTER_OPERATIONS = [
  'trigger_dev_list_runs',
  'trigger_dev_list_deployments',
  'trigger_dev_list_waitpoint_tokens',
  'trigger_dev_execute_query',
]
const CURSOR_PAGE_OPERATIONS = [
  'trigger_dev_list_runs',
  'trigger_dev_list_deployments',
  'trigger_dev_list_waitpoint_tokens',
]
const PAGE_BEFORE_OPERATIONS = ['trigger_dev_list_runs', 'trigger_dev_list_waitpoint_tokens']
const NUMBERED_PAGE_OPERATIONS = ['trigger_dev_list_schedules', 'trigger_dev_list_queues']

export const TriggerDevBlock: BlockConfig<TriggerDevResponse> = {
  type: 'trigger_dev',
  name: 'Trigger.dev',
  description: 'Trigger tasks and manage runs and schedules',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Trigger.dev into the workflow. Trigger and batch trigger background tasks, retrieve and control runs (cancel, replay, reschedule, tags, metadata, events, traces), manage cron schedules, environment variables, queues, deployments, and waitpoint tokens, and query run data with TRQL.',
  docsLink: 'https://docs.sim.ai/integrations/trigger_dev',
  category: 'tools',
  integrationType: IntegrationType.DevOps,
  bgColor: '#000000',
  icon: TriggerDevIcon,

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Trigger Task', id: 'trigger_dev_trigger_task' },
        { label: 'Batch Trigger Task', id: 'trigger_dev_batch_trigger_task' },
        { label: 'Get Batch', id: 'trigger_dev_get_batch' },
        { label: 'Get Batch Results', id: 'trigger_dev_get_batch_results' },
        { label: 'Get Run', id: 'trigger_dev_get_run' },
        { label: 'Get Run Result', id: 'trigger_dev_get_run_result' },
        { label: 'Get Run Events', id: 'trigger_dev_get_run_events' },
        { label: 'Get Run Trace', id: 'trigger_dev_get_run_trace' },
        { label: 'List Runs', id: 'trigger_dev_list_runs' },
        { label: 'Cancel Run', id: 'trigger_dev_cancel_run' },
        { label: 'Replay Run', id: 'trigger_dev_replay_run' },
        { label: 'Reschedule Run', id: 'trigger_dev_reschedule_run' },
        { label: 'Add Run Tags', id: 'trigger_dev_add_run_tags' },
        { label: 'Update Run Metadata', id: 'trigger_dev_update_run_metadata' },
        { label: 'Create Schedule', id: 'trigger_dev_create_schedule' },
        { label: 'Get Schedule', id: 'trigger_dev_get_schedule' },
        { label: 'List Schedules', id: 'trigger_dev_list_schedules' },
        { label: 'Update Schedule', id: 'trigger_dev_update_schedule' },
        { label: 'Delete Schedule', id: 'trigger_dev_delete_schedule' },
        { label: 'Activate Schedule', id: 'trigger_dev_activate_schedule' },
        { label: 'Deactivate Schedule', id: 'trigger_dev_deactivate_schedule' },
        { label: 'List Env Vars', id: 'trigger_dev_list_env_vars' },
        { label: 'Create Env Var', id: 'trigger_dev_create_env_var' },
        { label: 'Get Env Var', id: 'trigger_dev_get_env_var' },
        { label: 'Update Env Var', id: 'trigger_dev_update_env_var' },
        { label: 'Delete Env Var', id: 'trigger_dev_delete_env_var' },
        { label: 'Import Env Vars', id: 'trigger_dev_import_env_vars' },
        { label: 'Get Queue', id: 'trigger_dev_get_queue' },
        { label: 'List Queues', id: 'trigger_dev_list_queues' },
        { label: 'Pause Queue', id: 'trigger_dev_pause_queue' },
        { label: 'Resume Queue', id: 'trigger_dev_resume_queue' },
        { label: 'Override Queue Concurrency', id: 'trigger_dev_override_queue_concurrency' },
        { label: 'Reset Queue Concurrency', id: 'trigger_dev_reset_queue_concurrency' },
        { label: 'List Deployments', id: 'trigger_dev_list_deployments' },
        { label: 'Get Deployment', id: 'trigger_dev_get_deployment' },
        { label: 'Get Latest Deployment', id: 'trigger_dev_get_latest_deployment' },
        { label: 'Promote Deployment', id: 'trigger_dev_promote_deployment' },
        { label: 'Execute Query', id: 'trigger_dev_execute_query' },
        { label: 'Get Query Schema', id: 'trigger_dev_get_query_schema' },
        { label: 'Create Waitpoint Token', id: 'trigger_dev_create_waitpoint_token' },
        { label: 'Complete Waitpoint Token', id: 'trigger_dev_complete_waitpoint_token' },
        { label: 'Get Waitpoint Token', id: 'trigger_dev_get_waitpoint_token' },
        { label: 'List Waitpoint Tokens', id: 'trigger_dev_list_waitpoint_tokens' },
        { label: 'List Timezones', id: 'trigger_dev_list_timezones' },
      ],
      value: () => 'trigger_dev_trigger_task',
    },
    {
      id: 'apiKey',
      title: 'Secret API Key',
      type: 'short-input',
      password: true,
      placeholder: 'Enter your Trigger.dev secret API key (tr_...)',
      required: true,
    },
    // Trigger Task fields
    {
      id: 'taskIdentifier',
      title: 'Task Identifier',
      type: 'short-input',
      placeholder: 'e.g., send-welcome-email',
      condition: { field: 'operation', value: TASK_IDENTIFIER_OPERATIONS },
      required: { field: 'operation', value: TASK_IDENTIFIER_OPERATIONS },
    },
    {
      id: 'payload',
      title: 'Payload',
      type: 'code',
      language: 'json',
      placeholder: '{\n  "userId": "user_123"\n}',
      condition: { field: 'operation', value: 'trigger_dev_trigger_task' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON payload for a Trigger.dev task based on the user's description.
The payload is passed to the task's run function and can include any valid JSON.

Current input: {context}

Examples:
- "send a welcome email to user 123" ->
{"userId": "user_123", "template": "welcome"}

- "process order 456 with priority shipping" ->
{"orderId": "order_456", "shipping": "priority"}

Return ONLY the valid JSON object - no explanations, no markdown.`,
        placeholder: 'Describe the payload you need...',
        generationType: 'json-object',
      },
    },
    {
      id: 'idempotencyKey',
      title: 'Idempotency Key',
      type: 'short-input',
      placeholder: 'Unique key to deduplicate requests',
      mode: 'advanced',
      condition: { field: 'operation', value: IDEMPOTENCY_KEY_OPERATIONS },
    },
    {
      id: 'queue',
      title: 'Queue',
      type: 'short-input',
      placeholder: 'Queue name to run the task on',
      mode: 'advanced',
      condition: { field: 'operation', value: 'trigger_dev_trigger_task' },
    },
    {
      id: 'concurrencyKey',
      title: 'Concurrency Key',
      type: 'short-input',
      placeholder: 'Key to scope the concurrency limit (e.g., a user ID)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'trigger_dev_trigger_task' },
    },
    {
      id: 'delay',
      title: 'Delay',
      type: 'short-input',
      placeholder: 'e.g., 30m, 1h, or an ISO 8601 date',
      mode: 'advanced',
      condition: { field: 'operation', value: 'trigger_dev_trigger_task' },
    },
    {
      id: 'ttl',
      title: 'TTL',
      type: 'short-input',
      placeholder: 'e.g., 1h42m, or seconds',
      mode: 'advanced',
      condition: { field: 'operation', value: 'trigger_dev_trigger_task' },
    },
    {
      id: 'machine',
      title: 'Machine',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: 'Micro', id: 'micro' },
        { label: 'Small 1x', id: 'small-1x' },
        { label: 'Small 2x', id: 'small-2x' },
        { label: 'Medium 1x', id: 'medium-1x' },
        { label: 'Medium 2x', id: 'medium-2x' },
        { label: 'Large 1x', id: 'large-1x' },
        { label: 'Large 2x', id: 'large-2x' },
      ],
      value: () => '',
      mode: 'advanced',
      condition: { field: 'operation', value: 'trigger_dev_trigger_task' },
    },
    {
      id: 'tags',
      title: 'Tags',
      type: 'short-input',
      placeholder: 'user_123, org_456 (comma-separated, max 10)',
      mode: 'advanced',
      condition: { field: 'operation', value: TAGS_OPERATIONS },
    },
    // Batch Trigger Task fields
    {
      id: 'items',
      title: 'Batch Items',
      type: 'code',
      language: 'json',
      placeholder:
        '[\n  { "payload": { "userId": "user_1" } },\n  { "payload": { "userId": "user_2" }, "options": { "delay": "1h" } }\n]',
      condition: { field: 'operation', value: 'trigger_dev_batch_trigger_task' },
      required: { field: 'operation', value: 'trigger_dev_batch_trigger_task' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON array of batch items for a Trigger.dev task based on the user's description.
Each item is an object with a "payload" (any valid JSON) and optional "options" (queue, concurrencyKey, idempotencyKey, ttl, delay, tags, machine).

Current input: {context}

Examples:
- "send welcome emails to users 1 and 2" ->
[{"payload": {"userId": "user_1"}}, {"payload": {"userId": "user_2"}}]

- "process orders 10 and 11, the second after an hour" ->
[{"payload": {"orderId": "order_10"}}, {"payload": {"orderId": "order_11"}, "options": {"delay": "1h"}}]

Return ONLY the valid JSON array - no explanations, no markdown.`,
        placeholder: 'Describe the batch items you need...',
        generationType: 'json-object',
      },
    },
    // Batch fields
    {
      id: 'batchId',
      title: 'Batch ID',
      type: 'short-input',
      placeholder: 'e.g., batch_abc123',
      condition: { field: 'operation', value: BATCH_ID_OPERATIONS },
      required: { field: 'operation', value: BATCH_ID_OPERATIONS },
    },
    // Run fields
    {
      id: 'runId',
      title: 'Run ID',
      type: 'short-input',
      placeholder: 'e.g., run_abc123',
      condition: { field: 'operation', value: RUN_ID_OPERATIONS },
      required: { field: 'operation', value: RUN_ID_OPERATIONS },
    },
    {
      id: 'rescheduleDelay',
      title: 'Delay',
      type: 'short-input',
      placeholder: 'e.g., 30m, 1h, or an ISO 8601 date',
      condition: { field: 'operation', value: 'trigger_dev_reschedule_run' },
      required: { field: 'operation', value: 'trigger_dev_reschedule_run' },
    },
    {
      id: 'runTags',
      title: 'Tags',
      type: 'short-input',
      placeholder: 'user_123, org_456 (comma-separated, max 10 total)',
      condition: { field: 'operation', value: 'trigger_dev_add_run_tags' },
      required: { field: 'operation', value: 'trigger_dev_add_run_tags' },
    },
    {
      id: 'metadata',
      title: 'Metadata',
      type: 'code',
      language: 'json',
      placeholder: '{\n  "stage": "approved"\n}',
      condition: { field: 'operation', value: 'trigger_dev_update_run_metadata' },
      required: { field: 'operation', value: 'trigger_dev_update_run_metadata' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON metadata object for a Trigger.dev run based on the user's description.
The metadata replaces the run's existing metadata and can include any valid JSON.

Current input: {context}

Example:
- "mark the run as approved by ops" ->
{"stage": "approved", "approvedBy": "ops"}

Return ONLY the valid JSON object - no explanations, no markdown.`,
        placeholder: 'Describe the metadata you need...',
        generationType: 'json-object',
      },
    },
    // List Runs filters
    {
      id: 'status',
      title: 'Status Filter',
      type: 'short-input',
      placeholder: 'COMPLETED, FAILED (comma-separated)',
      condition: { field: 'operation', value: 'trigger_dev_list_runs' },
    },
    {
      id: 'filterTaskIdentifier',
      title: 'Task Filter',
      type: 'short-input',
      placeholder: 'send-welcome-email, daily-report (comma-separated)',
      condition: { field: 'operation', value: 'trigger_dev_list_runs' },
    },
    {
      id: 'period',
      title: 'Time Period',
      type: 'short-input',
      placeholder: 'e.g., 1h, 7d',
      mode: 'advanced',
      condition: { field: 'operation', value: CREATED_AT_FILTER_OPERATIONS },
    },
    {
      id: 'from',
      title: 'From',
      type: 'short-input',
      placeholder: '2024-01-01T00:00:00.000Z',
      mode: 'advanced',
      condition: { field: 'operation', value: CREATED_AT_FILTER_OPERATIONS },
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp based on the user's description.
Use the current date context to resolve relative references like "yesterday" or "last week".

Current input: {context}

Return ONLY the timestamp string - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the start of the time range (e.g., "yesterday", "last week")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'to',
      title: 'To',
      type: 'short-input',
      placeholder: '2024-12-31T23:59:59.999Z',
      mode: 'advanced',
      condition: { field: 'operation', value: CREATED_AT_FILTER_OPERATIONS },
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp based on the user's description.
Use the current date context to resolve relative references like "today" or "an hour ago".

Current input: {context}

Return ONLY the timestamp string - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the end of the time range (e.g., "now", "end of today")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'version',
      title: 'Version Filter',
      type: 'short-input',
      placeholder: '20240101.1 (comma-separated)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'trigger_dev_list_runs' },
    },
    {
      id: 'tag',
      title: 'Tag Filter',
      type: 'short-input',
      placeholder: 'user_123, org_456 (comma-separated)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'trigger_dev_list_runs' },
    },
    {
      id: 'schedule',
      title: 'Schedule Filter',
      type: 'short-input',
      placeholder: 'e.g., sched_abc123',
      mode: 'advanced',
      condition: { field: 'operation', value: 'trigger_dev_list_runs' },
    },
    {
      id: 'isTest',
      title: 'Test Runs',
      type: 'dropdown',
      options: [
        { label: 'All Runs', id: '' },
        { label: 'Only Test Runs', id: 'true' },
        { label: 'Exclude Test Runs', id: 'false' },
      ],
      value: () => '',
      mode: 'advanced',
      condition: { field: 'operation', value: 'trigger_dev_list_runs' },
    },
    {
      id: 'pageSize',
      title: 'Page Size',
      type: 'short-input',
      placeholder: 'Items per page (max 100)',
      mode: 'advanced',
      condition: { field: 'operation', value: CURSOR_PAGE_OPERATIONS },
    },
    {
      id: 'pageAfter',
      title: 'Page After',
      type: 'short-input',
      placeholder: 'Cursor to start the page after',
      mode: 'advanced',
      condition: { field: 'operation', value: CURSOR_PAGE_OPERATIONS },
    },
    {
      id: 'pageBefore',
      title: 'Page Before',
      type: 'short-input',
      placeholder: 'Cursor to start the page before',
      mode: 'advanced',
      condition: { field: 'operation', value: PAGE_BEFORE_OPERATIONS },
    },
    // Schedule fields
    {
      id: 'scheduleId',
      title: 'Schedule ID',
      type: 'short-input',
      placeholder: 'e.g., sched_abc123',
      condition: { field: 'operation', value: SCHEDULE_ID_OPERATIONS },
      required: { field: 'operation', value: SCHEDULE_ID_OPERATIONS },
    },
    {
      id: 'task',
      title: 'Task Identifier',
      type: 'short-input',
      placeholder: 'e.g., daily-report',
      condition: { field: 'operation', value: SCHEDULE_DEFINITION_OPERATIONS },
      required: { field: 'operation', value: SCHEDULE_DEFINITION_OPERATIONS },
    },
    {
      id: 'cron',
      title: 'Cron Expression',
      type: 'short-input',
      placeholder: 'e.g., 0 0 * * *',
      condition: { field: 'operation', value: SCHEDULE_DEFINITION_OPERATIONS },
      required: { field: 'operation', value: SCHEDULE_DEFINITION_OPERATIONS },
    },
    {
      id: 'timezone',
      title: 'Timezone',
      type: 'short-input',
      placeholder: 'e.g., America/New_York (default UTC)',
      mode: 'advanced',
      condition: { field: 'operation', value: SCHEDULE_DEFINITION_OPERATIONS },
    },
    {
      id: 'externalId',
      title: 'External ID',
      type: 'short-input',
      placeholder: 'e.g., a user or org ID to associate',
      mode: 'advanced',
      condition: { field: 'operation', value: SCHEDULE_DEFINITION_OPERATIONS },
    },
    {
      id: 'deduplicationKey',
      title: 'Deduplication Key',
      type: 'short-input',
      placeholder: 'Key to prevent duplicate schedules',
      condition: { field: 'operation', value: 'trigger_dev_create_schedule' },
      required: { field: 'operation', value: 'trigger_dev_create_schedule' },
    },
    // List Schedules / List Queues pagination
    {
      id: 'page',
      title: 'Page',
      type: 'short-input',
      placeholder: 'Page number (default 1)',
      mode: 'advanced',
      condition: { field: 'operation', value: NUMBERED_PAGE_OPERATIONS },
    },
    {
      id: 'perPage',
      title: 'Per Page',
      type: 'short-input',
      placeholder: 'Items per page',
      mode: 'advanced',
      condition: { field: 'operation', value: NUMBERED_PAGE_OPERATIONS },
    },
    // Environment variable fields
    {
      id: 'projectRef',
      title: 'Project Ref',
      type: 'short-input',
      placeholder: 'e.g., proj_yubjwjsfkxnylobaqvqz',
      condition: { field: 'operation', value: ENV_VAR_OPERATIONS },
      required: { field: 'operation', value: ENV_VAR_OPERATIONS },
    },
    {
      id: 'environment',
      title: 'Environment',
      type: 'dropdown',
      options: [
        { label: 'Dev', id: 'dev' },
        { label: 'Staging', id: 'staging' },
        { label: 'Prod', id: 'prod' },
      ],
      value: () => 'dev',
      condition: { field: 'operation', value: ENV_VAR_OPERATIONS },
      required: { field: 'operation', value: ENV_VAR_OPERATIONS },
    },
    {
      id: 'name',
      title: 'Variable Name',
      type: 'short-input',
      placeholder: 'e.g., SLACK_API_KEY',
      condition: { field: 'operation', value: ENV_VAR_NAME_OPERATIONS },
      required: { field: 'operation', value: ENV_VAR_NAME_OPERATIONS },
    },
    {
      id: 'value',
      title: 'Variable Value',
      type: 'short-input',
      password: true,
      placeholder: 'Value of the environment variable',
      condition: { field: 'operation', value: ENV_VAR_VALUE_OPERATIONS },
      required: { field: 'operation', value: ENV_VAR_VALUE_OPERATIONS },
    },
    {
      id: 'variables',
      title: 'Variables',
      type: 'code',
      language: 'json',
      placeholder: '[\n  { "name": "SLACK_API_KEY", "value": "slack_123" }\n]',
      condition: { field: 'operation', value: 'trigger_dev_import_env_vars' },
      required: { field: 'operation', value: 'trigger_dev_import_env_vars' },
    },
    {
      id: 'override',
      title: 'Override Existing',
      type: 'dropdown',
      options: [
        { label: 'No (default)', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      mode: 'advanced',
      condition: { field: 'operation', value: 'trigger_dev_import_env_vars' },
    },
    // Queue fields
    {
      id: 'queueName',
      title: 'Queue',
      type: 'short-input',
      placeholder: 'Queue ID, task identifier, or custom queue name',
      condition: { field: 'operation', value: QUEUE_OPERATIONS },
      required: { field: 'operation', value: QUEUE_OPERATIONS },
    },
    {
      id: 'queueType',
      title: 'Queue Type',
      type: 'dropdown',
      options: [
        { label: 'Queue ID', id: 'id' },
        { label: 'Task Identifier', id: 'task' },
        { label: 'Custom Queue Name', id: 'custom' },
      ],
      value: () => 'id',
      condition: { field: 'operation', value: QUEUE_OPERATIONS },
    },
    {
      id: 'concurrencyLimit',
      title: 'Concurrency Limit',
      type: 'short-input',
      placeholder: 'New concurrency limit (0 to 100000)',
      condition: { field: 'operation', value: 'trigger_dev_override_queue_concurrency' },
      required: { field: 'operation', value: 'trigger_dev_override_queue_concurrency' },
    },
    // Deployment fields
    {
      id: 'deploymentId',
      title: 'Deployment ID',
      type: 'short-input',
      placeholder: 'ID of the deployment',
      condition: { field: 'operation', value: 'trigger_dev_get_deployment' },
      required: { field: 'operation', value: 'trigger_dev_get_deployment' },
    },
    {
      id: 'deploymentVersion',
      title: 'Deployment Version',
      type: 'short-input',
      placeholder: 'e.g., 20250228.1',
      condition: { field: 'operation', value: 'trigger_dev_promote_deployment' },
      required: { field: 'operation', value: 'trigger_dev_promote_deployment' },
    },
    {
      id: 'deploymentStatus',
      title: 'Status Filter',
      type: 'dropdown',
      options: [
        { label: 'All', id: '' },
        { label: 'Pending', id: 'PENDING' },
        { label: 'Building', id: 'BUILDING' },
        { label: 'Deploying', id: 'DEPLOYING' },
        { label: 'Deployed', id: 'DEPLOYED' },
        { label: 'Failed', id: 'FAILED' },
        { label: 'Canceled', id: 'CANCELED' },
        { label: 'Timed Out', id: 'TIMED_OUT' },
      ],
      value: () => '',
      mode: 'advanced',
      condition: { field: 'operation', value: 'trigger_dev_list_deployments' },
    },
    // Query fields
    {
      id: 'query',
      title: 'TRQL Query',
      type: 'long-input',
      placeholder: "SELECT run_id, status, triggered_at FROM runs WHERE status = 'Failed' LIMIT 10",
      condition: { field: 'operation', value: 'trigger_dev_execute_query' },
      required: { field: 'operation', value: 'trigger_dev_execute_query' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a TRQL query for Trigger.dev run data based on the user's description.
TRQL is a SQL-like language; the main table is "runs" with columns like run_id, task_identifier, status, triggered_at, duration_ms, cost_in_cents, and tags.

Current input: {context}

Examples:
- "failed runs from the last day" ->
SELECT run_id, task_identifier, status, triggered_at FROM runs WHERE status = 'Failed' ORDER BY triggered_at DESC LIMIT 100

- "cost per task this week" ->
SELECT task_identifier, SUM(cost_in_cents) AS total_cost FROM runs GROUP BY task_identifier ORDER BY total_cost DESC

Return ONLY the TRQL query - no explanations, no markdown.`,
        placeholder: 'Describe the query you need...',
        generationType: 'sql-query',
      },
    },
    {
      id: 'scope',
      title: 'Scope',
      type: 'dropdown',
      options: [
        { label: 'Environment (default)', id: 'environment' },
        { label: 'Project', id: 'project' },
        { label: 'Organization', id: 'organization' },
      ],
      value: () => 'environment',
      mode: 'advanced',
      condition: { field: 'operation', value: 'trigger_dev_execute_query' },
    },
    {
      id: 'format',
      title: 'Format',
      type: 'dropdown',
      options: [
        { label: 'JSON (default)', id: 'json' },
        { label: 'CSV', id: 'csv' },
      ],
      value: () => 'json',
      mode: 'advanced',
      condition: { field: 'operation', value: 'trigger_dev_execute_query' },
    },
    // Waitpoint fields
    {
      id: 'waitpointId',
      title: 'Waitpoint ID',
      type: 'short-input',
      placeholder: 'e.g., waitpoint_abc123',
      condition: { field: 'operation', value: WAITPOINT_ID_OPERATIONS },
      required: { field: 'operation', value: WAITPOINT_ID_OPERATIONS },
    },
    {
      id: 'waitpointData',
      title: 'Completion Data',
      type: 'code',
      language: 'json',
      placeholder: '{\n  "status": "approved"\n}',
      condition: { field: 'operation', value: 'trigger_dev_complete_waitpoint_token' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON object to pass back to a Trigger.dev run waiting on a waitpoint token.
The data is returned to the task as the token result.

Current input: {context}

Example:
- "approve with a comment" ->
{"status": "approved", "comment": "Looks good"}

Return ONLY the valid JSON object - no explanations, no markdown.`,
        placeholder: 'Describe the completion data you need...',
        generationType: 'json-object',
      },
    },
    {
      id: 'timeout',
      title: 'Timeout',
      type: 'short-input',
      placeholder: 'e.g., 30s, 1m, 2h, or an ISO 8601 date',
      condition: { field: 'operation', value: 'trigger_dev_create_waitpoint_token' },
    },
    {
      id: 'idempotencyKeyTTL',
      title: 'Idempotency Key TTL',
      type: 'short-input',
      placeholder: 'e.g., 30s, 1m, 2h, 3d',
      mode: 'advanced',
      condition: { field: 'operation', value: 'trigger_dev_create_waitpoint_token' },
    },
    {
      id: 'waitpointStatus',
      title: 'Status Filter',
      type: 'dropdown',
      options: [
        { label: 'All', id: '' },
        { label: 'Waiting', id: 'WAITING' },
        { label: 'Completed', id: 'COMPLETED' },
        { label: 'Timed Out', id: 'TIMED_OUT' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'trigger_dev_list_waitpoint_tokens' },
    },
    {
      id: 'filterIdempotencyKey',
      title: 'Idempotency Key Filter',
      type: 'short-input',
      placeholder: 'Idempotency key to filter by',
      mode: 'advanced',
      condition: { field: 'operation', value: 'trigger_dev_list_waitpoint_tokens' },
    },
    {
      id: 'waitpointTags',
      title: 'Tag Filter',
      type: 'short-input',
      placeholder: 'user_123, org_456 (comma-separated)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'trigger_dev_list_waitpoint_tokens' },
    },
    // Timezone fields
    {
      id: 'excludeUtc',
      title: 'Exclude UTC',
      type: 'dropdown',
      options: [
        { label: 'No (default)', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      mode: 'advanced',
      condition: { field: 'operation', value: 'trigger_dev_list_timezones' },
    },
  ],

  tools: {
    access: [
      'trigger_dev_trigger_task',
      'trigger_dev_batch_trigger_task',
      'trigger_dev_get_batch',
      'trigger_dev_get_batch_results',
      'trigger_dev_get_run',
      'trigger_dev_get_run_result',
      'trigger_dev_get_run_events',
      'trigger_dev_get_run_trace',
      'trigger_dev_list_runs',
      'trigger_dev_cancel_run',
      'trigger_dev_replay_run',
      'trigger_dev_reschedule_run',
      'trigger_dev_add_run_tags',
      'trigger_dev_update_run_metadata',
      'trigger_dev_create_schedule',
      'trigger_dev_get_schedule',
      'trigger_dev_list_schedules',
      'trigger_dev_update_schedule',
      'trigger_dev_delete_schedule',
      'trigger_dev_activate_schedule',
      'trigger_dev_deactivate_schedule',
      'trigger_dev_list_env_vars',
      'trigger_dev_create_env_var',
      'trigger_dev_get_env_var',
      'trigger_dev_update_env_var',
      'trigger_dev_delete_env_var',
      'trigger_dev_import_env_vars',
      'trigger_dev_get_queue',
      'trigger_dev_list_queues',
      'trigger_dev_pause_queue',
      'trigger_dev_resume_queue',
      'trigger_dev_override_queue_concurrency',
      'trigger_dev_reset_queue_concurrency',
      'trigger_dev_list_deployments',
      'trigger_dev_get_deployment',
      'trigger_dev_get_latest_deployment',
      'trigger_dev_promote_deployment',
      'trigger_dev_execute_query',
      'trigger_dev_get_query_schema',
      'trigger_dev_create_waitpoint_token',
      'trigger_dev_complete_waitpoint_token',
      'trigger_dev_get_waitpoint_token',
      'trigger_dev_list_waitpoint_tokens',
      'trigger_dev_list_timezones',
    ],
    config: {
      tool: (params) => params.operation,
      params: (params) => {
        const operation = params.operation as string
        const result: Record<string, unknown> = {}

        const scoped = (value: unknown, operations: string[]) =>
          operations.includes(operation) && value !== undefined && value !== null && value !== ''
            ? value
            : undefined

        result.taskIdentifier =
          scoped(params.taskIdentifier, TASK_IDENTIFIER_OPERATIONS) ??
          scoped(params.filterTaskIdentifier, ['trigger_dev_list_runs'])
        result.delay =
          scoped(params.delay, ['trigger_dev_trigger_task']) ??
          scoped(params.rescheduleDelay, ['trigger_dev_reschedule_run'])
        result.tags =
          scoped(params.tags, TAGS_OPERATIONS) ??
          scoped(params.runTags, ['trigger_dev_add_run_tags']) ??
          scoped(params.waitpointTags, ['trigger_dev_list_waitpoint_tokens'])
        result.idempotencyKey =
          scoped(params.idempotencyKey, IDEMPOTENCY_KEY_OPERATIONS) ??
          scoped(params.filterIdempotencyKey, ['trigger_dev_list_waitpoint_tokens'])
        result.status =
          scoped(params.status, ['trigger_dev_list_runs']) ??
          scoped(params.deploymentStatus, ['trigger_dev_list_deployments']) ??
          scoped(params.waitpointStatus, ['trigger_dev_list_waitpoint_tokens'])
        result.version =
          scoped(params.version, ['trigger_dev_list_runs']) ??
          scoped(params.deploymentVersion, ['trigger_dev_promote_deployment'])
        result.data = scoped(params.waitpointData, ['trigger_dev_complete_waitpoint_token'])
        result.period = scoped(params.period, CREATED_AT_FILTER_OPERATIONS)
        result.from = scoped(params.from, CREATED_AT_FILTER_OPERATIONS)
        result.to = scoped(params.to, CREATED_AT_FILTER_OPERATIONS)

        const scopedNumber = (value: unknown, operations: string[]) => {
          const raw = scoped(value, operations)
          return raw === undefined ? undefined : Number(raw)
        }
        result.concurrencyLimit = scopedNumber(params.concurrencyLimit, [
          'trigger_dev_override_queue_concurrency',
        ])
        result.pageSize = scopedNumber(params.pageSize, CURSOR_PAGE_OPERATIONS)
        result.pageAfter = scoped(params.pageAfter, CURSOR_PAGE_OPERATIONS)
        result.pageBefore = scoped(params.pageBefore, PAGE_BEFORE_OPERATIONS)
        result.page = scopedNumber(params.page, NUMBERED_PAGE_OPERATIONS)
        result.perPage = scopedNumber(params.perPage, NUMBERED_PAGE_OPERATIONS)

        return result
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Trigger.dev secret API key' },
    // Trigger Task
    taskIdentifier: { type: 'string', description: 'Identifier of the task to trigger' },
    payload: { type: 'json', description: 'JSON payload passed to the task run' },
    idempotencyKey: { type: 'string', description: 'Idempotency key to deduplicate triggers' },
    queue: { type: 'string', description: 'Queue name to run the task on' },
    concurrencyKey: { type: 'string', description: 'Key to scope the concurrency limit' },
    delay: { type: 'string', description: 'Delay before the run executes' },
    ttl: { type: 'string', description: 'Time-to-live before an unstarted run expires' },
    machine: { type: 'string', description: 'Machine preset for the run' },
    tags: { type: 'string', description: 'Comma-separated tags to attach to the run' },
    // Batch Trigger Task
    items: {
      type: 'json',
      description: 'JSON array of batch items, each with a payload and optional options',
    },
    batchId: { type: 'string', description: 'Batch ID (starts with batch_)' },
    // Runs
    runId: { type: 'string', description: 'Run ID (starts with run_)' },
    rescheduleDelay: { type: 'string', description: 'New delay for a delayed run' },
    runTags: { type: 'string', description: 'Comma-separated tags to add to a run' },
    metadata: { type: 'json', description: 'JSON object to set as the run metadata' },
    status: { type: 'string', description: 'Comma-separated run statuses to filter by' },
    filterTaskIdentifier: {
      type: 'string',
      description: 'Comma-separated task identifiers to filter by',
    },
    period: { type: 'string', description: 'Only return runs created in the given period' },
    from: { type: 'string', description: 'Only return runs created on or after this timestamp' },
    to: { type: 'string', description: 'Only return runs created on or before this timestamp' },
    version: { type: 'string', description: 'Comma-separated worker versions to filter by' },
    tag: { type: 'string', description: 'Comma-separated tags to filter by' },
    schedule: { type: 'string', description: 'Schedule ID to filter runs by' },
    isTest: { type: 'string', description: 'Filter by test runs ("true" or "false")' },
    pageSize: { type: 'number', description: 'Number of runs per page (max 100)' },
    pageAfter: { type: 'string', description: 'Run ID to start the page after' },
    pageBefore: { type: 'string', description: 'Run ID to start the page before' },
    // Schedules
    scheduleId: { type: 'string', description: 'Schedule ID (starts with sched_)' },
    task: { type: 'string', description: 'Identifier of the task the schedule triggers' },
    cron: { type: 'string', description: 'Cron expression defining when the task runs' },
    timezone: { type: 'string', description: 'IANA timezone for the cron expression' },
    externalId: { type: 'string', description: 'External identifier for the schedule' },
    deduplicationKey: { type: 'string', description: 'Key to prevent duplicate schedules' },
    page: { type: 'number', description: 'Page number for listing schedules' },
    perPage: { type: 'number', description: 'Number of schedules per page' },
    // Environment variables
    projectRef: { type: 'string', description: 'Project ref (starts with proj_)' },
    environment: { type: 'string', description: 'Project environment (dev, staging, or prod)' },
    name: { type: 'string', description: 'Name of the environment variable' },
    value: { type: 'string', description: 'Value of the environment variable' },
    variables: {
      type: 'json',
      description: 'JSON array of environment variables to import ({name, value} objects)',
    },
    override: {
      type: 'string',
      description: 'Whether to override existing variables on import ("true" or "false")',
    },
    // Queues
    queueName: {
      type: 'string',
      description: 'Queue ID, task identifier, or custom queue name',
    },
    queueType: {
      type: 'string',
      description: 'How to interpret the queue name (id, task, or custom)',
    },
    concurrencyLimit: {
      type: 'number',
      description: 'New concurrency limit for the queue (0 to 100000)',
    },
    // Deployments
    deploymentId: { type: 'string', description: 'ID of the deployment to retrieve' },
    deploymentVersion: { type: 'string', description: 'Deployment version to promote' },
    deploymentStatus: { type: 'string', description: 'Deployment status to filter by' },
    // Query
    query: { type: 'string', description: 'TRQL query to execute' },
    scope: {
      type: 'string',
      description: 'Scope of data to query (environment, project, or organization)',
    },
    format: { type: 'string', description: 'Query response format (json or csv)' },
    // Waitpoints
    waitpointId: { type: 'string', description: 'Waitpoint token ID (starts with waitpoint_)' },
    waitpointData: {
      type: 'json',
      description: 'JSON data passed back to the run waiting on the token',
    },
    timeout: { type: 'string', description: 'How long before the waitpoint token times out' },
    idempotencyKeyTTL: {
      type: 'string',
      description: 'How long the waitpoint idempotency key is valid',
    },
    waitpointStatus: {
      type: 'string',
      description: 'Waitpoint status to filter by (WAITING, COMPLETED, or TIMED_OUT)',
    },
    filterIdempotencyKey: {
      type: 'string',
      description: 'Idempotency key to filter waitpoint tokens by',
    },
    waitpointTags: {
      type: 'string',
      description: 'Comma-separated tags to filter waitpoint tokens by',
    },
    // Timezones
    excludeUtc: {
      type: 'string',
      description: 'Whether to exclude UTC from the timezones ("true" or "false")',
    },
  },

  outputs: {
    // Trigger Task / Cancel Run / Replay Run / schedule operations
    id: { type: 'string', description: 'Run, schedule, or queue ID' },
    // Batches
    batchId: { type: 'string', description: 'Batch ID (Batch Trigger Task)' },
    runIds: { type: 'json', description: 'Run IDs in the batch (batch operations)' },
    runCount: { type: 'number', description: 'Total number of runs in the batch (Get Batch)' },
    successfulRunCount: {
      type: 'number',
      description: 'Number of successful runs in the batch (Get Batch)',
    },
    failedRunCount: {
      type: 'number',
      description: 'Number of failed runs in the batch (Get Batch)',
    },
    errors: { type: 'json', description: 'Error details for failed batch items (Get Batch)' },
    items: {
      type: 'json',
      description: 'Execution results for each run in the batch (Get Batch Results)',
    },
    // Get Run
    status: { type: 'string', description: 'Run status (Get Run)' },
    taskIdentifier: { type: 'string', description: 'Task identifier of the run (Get Run)' },
    createdAt: { type: 'string', description: 'When the run was created (Get Run)' },
    startedAt: { type: 'string', description: 'When the run started (Get Run)' },
    finishedAt: { type: 'string', description: 'When the run finished (Get Run)' },
    durationMs: { type: 'number', description: 'Compute duration in milliseconds (Get Run)' },
    costInCents: { type: 'number', description: 'Compute cost in cents (Get Run)' },
    isTest: { type: 'boolean', description: 'Whether the run is a test run (Get Run)' },
    tags: { type: 'json', description: 'Tags attached to the run (Get Run)' },
    payload: { type: 'json', description: 'Payload the run was triggered with (Get Run)' },
    output: { type: 'json', description: 'Output returned by the run (Get Run)' },
    attempts: { type: 'json', description: 'Attempts made for the run (Get Run)' },
    metadata: { type: 'json', description: 'Run metadata (Get Run, Update Run Metadata)' },
    ok: { type: 'boolean', description: 'Whether the run succeeded (Get Run Result)' },
    outputType: {
      type: 'string',
      description: 'Content type of the run output (Get Run Result)',
    },
    error: { type: 'json', description: 'Error details for a failed run (Get Run Result)' },
    message: { type: 'string', description: 'Confirmation message (Add Run Tags)' },
    events: { type: 'json', description: 'Log and span events of the run (Get Run Events)' },
    traceId: { type: 'string', description: 'OpenTelemetry trace ID (Get Run Trace)' },
    rootSpan: { type: 'json', description: 'Root span of the run trace (Get Run Trace)' },
    // List Runs / List Schedules
    runs: { type: 'json', description: 'Runs matching the filters (List Runs)' },
    schedules: { type: 'json', description: 'Schedules in the project (List Schedules)' },
    pagination: { type: 'json', description: 'Pagination details (list operations)' },
    // Schedules
    task: { type: 'string', description: 'Task the schedule triggers (schedule operations)' },
    active: {
      type: 'boolean',
      description: 'Whether the schedule is active (schedule operations)',
    },
    cron: { type: 'string', description: 'Cron expression (schedule operations)' },
    cronDescription: {
      type: 'string',
      description: 'Human-readable cron description (schedule operations)',
    },
    timezone: { type: 'string', description: 'Timezone of the schedule (schedule operations)' },
    nextRun: { type: 'string', description: 'Next scheduled run time (schedule operations)' },
    environments: {
      type: 'json',
      description: 'Environments the schedule runs in (schedule operations)',
    },
    deleted: { type: 'boolean', description: 'Whether the schedule was deleted (Delete Schedule)' },
    // Environment variables
    variables: {
      type: 'json',
      description: 'Environment variables in the project environment (List Env Vars)',
    },
    name: {
      type: 'string',
      description: 'Environment variable or queue name (env var and queue operations)',
    },
    value: { type: 'string', description: 'Value of the environment variable (Get Env Var)' },
    success: {
      type: 'boolean',
      description: 'Whether the operation succeeded (env var operations, Complete Waitpoint Token)',
    },
    count: {
      type: 'number',
      description: 'Number of environment variables submitted (Import Env Vars)',
    },
    // Queues
    queues: { type: 'json', description: 'Queues in the environment (List Queues)' },
    running: { type: 'number', description: 'Runs currently executing (queue operations)' },
    queued: { type: 'number', description: 'Runs waiting in the queue (queue operations)' },
    paused: { type: 'boolean', description: 'Whether the queue is paused (queue operations)' },
    concurrencyLimit: {
      type: 'number',
      description: 'Concurrency limit of the queue (queue operations)',
    },
    concurrency: {
      type: 'json',
      description: 'Concurrency details of the queue (queue operations)',
    },
    // Deployments
    deployments: {
      type: 'json',
      description: 'Deployments matching the filters (List Deployments)',
    },
    version: { type: 'string', description: 'Deployment version (deployment operations)' },
    shortCode: { type: 'string', description: 'Deployment short code (deployment operations)' },
    tasks: {
      type: 'json',
      description: 'Tasks registered by the deployed worker (deployment operations)',
    },
    // Query
    format: { type: 'string', description: 'Format of the query results (Execute Query)' },
    results: { type: 'json', description: 'Query results (Execute Query)' },
    tables: { type: 'json', description: 'Queryable TRQL tables and columns (Get Query Schema)' },
    // Waitpoints
    tokens: { type: 'json', description: 'Waitpoint tokens (List Waitpoint Tokens)' },
    url: { type: 'string', description: 'Waitpoint callback URL (waitpoint operations)' },
    isCached: {
      type: 'boolean',
      description: 'Whether an existing token was returned (Create Waitpoint Token)',
    },
    // Timezones
    timezones: { type: 'json', description: 'Supported IANA timezones (List Timezones)' },
  },
}

export const TriggerDevBlockMeta = {
  tags: ['automation', 'ci-cd', 'monitoring'],
  url: 'https://trigger.dev',
  templates: [
    {
      icon: TriggerDevIcon,
      title: 'Trigger.dev job kickoff',
      prompt:
        'Build a workflow that receives an event from another system, triggers the matching Trigger.dev background task with a JSON payload, and returns the run ID for tracking.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['automation'],
    },
    {
      icon: TriggerDevIcon,
      title: 'Trigger.dev failed-run monitor',
      prompt:
        'Build a scheduled workflow that lists Trigger.dev runs with status FAILED or CRASHED from the last hour, summarizes the failures per task, and posts a digest to the engineering Slack channel.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['monitoring', 'devops'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: TriggerDevIcon,
      title: 'Trigger.dev auto-retry agent',
      prompt:
        'Create an agent that lists failed Trigger.dev runs, inspects each run error to decide whether the failure looks transient, and replays the runs that are safe to retry.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['automation', 'devops'],
    },
    {
      icon: TriggerDevIcon,
      title: 'Trigger.dev run-output collector',
      prompt:
        'Build a workflow that triggers a Trigger.dev task, polls Get Run until the run completes, and writes the run output and timing details into a results table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['automation', 'sync'],
    },
    {
      icon: TriggerDevIcon,
      title: 'Trigger.dev schedule manager',
      prompt:
        'Create an agent that manages Trigger.dev cron schedules per customer — creating a schedule with the customer ID as external ID on signup, and deactivating or deleting it on churn.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['automation', 'scheduling'],
    },
    {
      icon: TriggerDevIcon,
      title: 'Trigger.dev stuck-run janitor',
      prompt:
        'Build a scheduled workflow that lists Trigger.dev runs still executing past their expected duration, cancels the stuck runs, and posts the canceled run IDs to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['monitoring', 'devops'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: TriggerDevIcon,
      title: 'Trigger.dev compute cost reporter',
      prompt:
        'Create a weekly scheduled workflow that uses Trigger.dev Execute Query to aggregate compute cost and duration per task for the past week, and emails a cost report to the team.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['reporting', 'devops'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: TriggerDevIcon,
      title: 'Trigger.dev human approval gate',
      prompt:
        'Build a workflow where a Trigger.dev task waits on a waitpoint token, an approver reviews the request in Slack, and the workflow completes the waitpoint token with the approval decision so the task resumes.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['automation', 'approvals'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: TriggerDevIcon,
      title: 'Trigger.dev deploy watchdog',
      prompt:
        'Create a workflow that checks the latest Trigger.dev deployment after each release, and if the deployment failed or new runs start crashing, promotes the previous deployment version and alerts the on-call channel.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'trigger-task-and-wait',
      description:
        'Trigger a Trigger.dev background task with a payload and poll until the run completes, returning its output.',
      content:
        '# Trigger Task and Wait\n\nKick off a Trigger.dev background task and collect its result.\n\n## Steps\n1. Use the Trigger Task operation with the task identifier and a JSON payload. Set an idempotency key when the same event might arrive twice.\n2. Poll the Get Run operation with the returned run ID until the status is COMPLETED, FAILED, CANCELED, CRASHED, or another terminal state.\n3. On COMPLETED, read the run output. On failure states, read the attempts to surface the error message.\n\n## Output\nReturn the run ID, final status, duration, and the run output — or the error details if the run did not complete.',
    },
    {
      name: 'monitor-failed-runs',
      description:
        'List recent failed Trigger.dev runs, group them by task, and produce a failure digest. Use for run health monitoring.',
      content:
        '# Monitor Failed Runs\n\nReview recent Trigger.dev failures and summarize what needs attention.\n\n## Steps\n1. Use the List Runs operation with a status filter of FAILED, CRASHED, SYSTEM_FAILURE and a created-within period (e.g., 1h or 1d).\n2. Group the runs by task identifier and count failures per task.\n3. For the most affected tasks, fetch a representative run with Get Run and pull the attempt error message.\n\n## Output\nReport failures per task with counts, representative error messages, and run IDs. If nothing failed, say so briefly.',
    },
    {
      name: 'replay-transient-failures',
      description:
        'Inspect failed Trigger.dev runs and replay the ones whose errors look transient (timeouts, rate limits, network).',
      content:
        '# Replay Transient Failures\n\nRetry failed Trigger.dev runs that are safe to run again.\n\n## Steps\n1. List runs with status FAILED for the relevant period and task filter.\n2. For each run, use Get Run and inspect the attempt errors. Treat timeouts, rate limits, and network errors as transient; treat validation and logic errors as permanent.\n3. Use the Replay Run operation on transient failures only, and record the new run IDs.\n\n## Output\nList the replayed runs (old run ID to new run ID) and the runs skipped as permanent failures, with the reason for each decision.',
    },
    {
      name: 'human-approval-waitpoint',
      description:
        'Create a Trigger.dev waitpoint token for a task to wait on, then complete it with approval data once a human decides.',
      content:
        '# Human Approval Waitpoint\n\nGate a Trigger.dev task on an external decision using waitpoint tokens.\n\n## Steps\n1. Use Create Waitpoint Token with a timeout (e.g., 1d) and an idempotency key tied to the request, and pass the token ID to the task that should wait.\n2. When the decision arrives, use Complete Waitpoint Token with the token ID and a JSON payload like {"status": "approved"} so the waiting run resumes with that data.\n3. Use Get Waitpoint Token or List Waitpoint Tokens to check for tokens that are still WAITING or have TIMED_OUT.\n\n## Output\nReport the token ID, its status, and the completion data passed to the run. Flag tokens that timed out without a decision.',
    },
    {
      name: 'manage-cron-schedules',
      description:
        'Create, update, activate, deactivate, or delete Trigger.dev cron schedules for a task, scoped by external ID.',
      content:
        '# Manage Cron Schedules\n\nKeep Trigger.dev schedules in sync with the desired cadence.\n\n## Steps\n1. Use List Schedules to find existing schedules for the task, matching on external ID when schedules are per customer or per resource.\n2. Create a schedule with the task identifier, cron expression, timezone, and a deduplication key so reruns do not create duplicates.\n3. Update the cron or timezone on an existing schedule by ID, and use Activate or Deactivate to pause and resume without deleting.\n4. Delete schedules that are no longer needed.\n\n## Output\nReport the schedule ID, task, cron expression, timezone, active state, and next run time after the change.',
    },
  ],
} as const satisfies BlockMeta
