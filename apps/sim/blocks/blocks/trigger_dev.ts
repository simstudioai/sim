import { TriggerDevIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { TriggerDevResponse } from '@/tools/trigger_dev/types'

const TASK_IDENTIFIER_OPERATIONS = ['trigger_dev_trigger_task', 'trigger_dev_batch_trigger_task']
const RUN_ID_OPERATIONS = [
  'trigger_dev_get_run',
  'trigger_dev_cancel_run',
  'trigger_dev_replay_run',
  'trigger_dev_reschedule_run',
  'trigger_dev_update_run_metadata',
]
const ENV_VAR_OPERATIONS = [
  'trigger_dev_list_env_vars',
  'trigger_dev_create_env_var',
  'trigger_dev_get_env_var',
  'trigger_dev_update_env_var',
  'trigger_dev_delete_env_var',
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

export const TriggerDevBlock: BlockConfig<TriggerDevResponse> = {
  type: 'trigger_dev',
  name: 'Trigger.dev',
  description: 'Trigger tasks and manage runs and schedules',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Trigger.dev into the workflow. Trigger and batch trigger background tasks with a JSON payload, retrieve and list runs, cancel, replay, or reschedule runs, manage cron schedules, environment variables, and queues.',
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
        { label: 'Get Run', id: 'trigger_dev_get_run' },
        { label: 'List Runs', id: 'trigger_dev_list_runs' },
        { label: 'Cancel Run', id: 'trigger_dev_cancel_run' },
        { label: 'Replay Run', id: 'trigger_dev_replay_run' },
        { label: 'Reschedule Run', id: 'trigger_dev_reschedule_run' },
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
        { label: 'Get Queue', id: 'trigger_dev_get_queue' },
        { label: 'Pause Queue', id: 'trigger_dev_pause_queue' },
        { label: 'Resume Queue', id: 'trigger_dev_resume_queue' },
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
      placeholder: 'Unique key to deduplicate triggers',
      mode: 'advanced',
      condition: { field: 'operation', value: 'trigger_dev_trigger_task' },
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
      condition: { field: 'operation', value: 'trigger_dev_trigger_task' },
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
      title: 'Created Within',
      type: 'short-input',
      placeholder: 'e.g., 1h, 7d',
      mode: 'advanced',
      condition: { field: 'operation', value: 'trigger_dev_list_runs' },
    },
    {
      id: 'from',
      title: 'Created From',
      type: 'short-input',
      placeholder: '2024-01-01T00:00:00.000Z',
      mode: 'advanced',
      condition: { field: 'operation', value: 'trigger_dev_list_runs' },
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
      title: 'Created To',
      type: 'short-input',
      placeholder: '2024-12-31T23:59:59.999Z',
      mode: 'advanced',
      condition: { field: 'operation', value: 'trigger_dev_list_runs' },
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
      placeholder: 'Runs per page (max 100, default 25)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'trigger_dev_list_runs' },
    },
    {
      id: 'pageAfter',
      title: 'Page After',
      type: 'short-input',
      placeholder: 'Run ID to start the page after',
      mode: 'advanced',
      condition: { field: 'operation', value: 'trigger_dev_list_runs' },
    },
    {
      id: 'pageBefore',
      title: 'Page Before',
      type: 'short-input',
      placeholder: 'Run ID to start the page before',
      mode: 'advanced',
      condition: { field: 'operation', value: 'trigger_dev_list_runs' },
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
      mode: 'advanced',
      condition: { field: 'operation', value: 'trigger_dev_create_schedule' },
    },
    // List Schedules pagination
    {
      id: 'page',
      title: 'Page',
      type: 'short-input',
      placeholder: 'Page number (default 1)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'trigger_dev_list_schedules' },
    },
    {
      id: 'perPage',
      title: 'Per Page',
      type: 'short-input',
      placeholder: 'Schedules per page',
      mode: 'advanced',
      condition: { field: 'operation', value: 'trigger_dev_list_schedules' },
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
  ],

  tools: {
    access: [
      'trigger_dev_trigger_task',
      'trigger_dev_batch_trigger_task',
      'trigger_dev_get_run',
      'trigger_dev_list_runs',
      'trigger_dev_cancel_run',
      'trigger_dev_replay_run',
      'trigger_dev_reschedule_run',
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
      'trigger_dev_get_queue',
      'trigger_dev_pause_queue',
      'trigger_dev_resume_queue',
    ],
    config: {
      tool: (params) => params.operation,
      params: (params) => {
        const result: Record<string, unknown> = {}
        if (params.filterTaskIdentifier) result.taskIdentifier = params.filterTaskIdentifier
        if (params.rescheduleDelay) result.delay = params.rescheduleDelay
        if (params.pageSize) result.pageSize = Number(params.pageSize)
        if (params.page) result.page = Number(params.page)
        if (params.perPage) result.perPage = Number(params.perPage)
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
    // Runs
    runId: { type: 'string', description: 'Run ID (starts with run_)' },
    rescheduleDelay: { type: 'string', description: 'New delay for a delayed run' },
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
    // Queues
    queueName: {
      type: 'string',
      description: 'Queue ID, task identifier, or custom queue name',
    },
    queueType: {
      type: 'string',
      description: 'How to interpret the queue name (id, task, or custom)',
    },
  },

  outputs: {
    // Trigger Task / Cancel Run / Replay Run / schedule operations
    id: { type: 'string', description: 'Run, schedule, or queue ID' },
    // Batch Trigger Task
    batchId: { type: 'string', description: 'Batch ID (Batch Trigger Task)' },
    runIds: { type: 'json', description: 'IDs of the created runs (Batch Trigger Task)' },
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
      description: 'Whether the env var operation succeeded (Create/Update/Delete Env Var)',
    },
    // Queues
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
  },
}

export const TriggerDevBlockMeta = {
  tags: ['automation', 'ci-cd', 'monitoring'],
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
        'Create a weekly scheduled workflow that lists Trigger.dev runs from the past week, aggregates compute cost and duration per task, and emails a cost report to the team.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['reporting', 'devops'],
      alsoIntegrations: ['gmail'],
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
      name: 'manage-cron-schedules',
      description:
        'Create, update, activate, deactivate, or delete Trigger.dev cron schedules for a task, scoped by external ID.',
      content:
        '# Manage Cron Schedules\n\nKeep Trigger.dev schedules in sync with the desired cadence.\n\n## Steps\n1. Use List Schedules to find existing schedules for the task, matching on external ID when schedules are per customer or per resource.\n2. Create a schedule with the task identifier, cron expression, timezone, and a deduplication key so reruns do not create duplicates.\n3. Update the cron or timezone on an existing schedule by ID, and use Activate or Deactivate to pause and resume without deleting.\n4. Delete schedules that are no longer needed.\n\n## Output\nReport the schedule ID, task, cron expression, timezone, active state, and next run time after the change.',
    },
  ],
} as const satisfies BlockMeta
