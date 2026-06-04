import { DagsterIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { IntegrationType } from '@/blocks/types'
import type { DagsterResponse } from '@/tools/dagster/types'

/** Coerces a subBlock value to a finite number, returning undefined for empty or non-numeric input. */
function toFiniteNumber(value: unknown): number | undefined {
  if (value == null || value === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

export const DagsterBlock: BlockConfig<DagsterResponse> = {
  type: 'dagster',
  name: 'Dagster',
  description: 'Orchestrate data pipelines and manage job runs with Dagster',
  longDescription:
    'Connect to a Dagster instance to launch job runs, monitor run status, list available jobs across repositories, terminate or delete runs, reexecute failed runs, fetch run logs, and manage schedules and sensors. API token only required for Dagster+.',
  docsLink: 'https://docs.sim.ai/tools/dagster',
  category: 'tools',
  integrationType: IntegrationType.Analytics,
  tags: ['data-analytics', 'automation'],
  bgColor: '#ffffff',
  icon: DagsterIcon,

  subBlocks: [
    // ── Operation selector ─────────────────────────────────────────────────────
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Launch Run', id: 'launch_run' },
        { label: 'Get Run', id: 'get_run' },
        { label: 'Get Run Logs', id: 'get_run_logs' },
        { label: 'List Runs', id: 'list_runs' },
        { label: 'List Jobs', id: 'list_jobs' },
        { label: 'Reexecute Run', id: 'reexecute_run' },
        { label: 'Terminate Run', id: 'terminate_run' },
        { label: 'Delete Run', id: 'delete_run' },
        { label: 'List Schedules', id: 'list_schedules' },
        { label: 'Start Schedule', id: 'start_schedule' },
        { label: 'Stop Schedule', id: 'stop_schedule' },
        { label: 'List Sensors', id: 'list_sensors' },
        { label: 'Start Sensor', id: 'start_sensor' },
        { label: 'Stop Sensor', id: 'stop_sensor' },
        { label: 'List Assets', id: 'list_assets' },
        { label: 'Get Asset', id: 'get_asset' },
        { label: 'Materialize Assets', id: 'materialize_assets' },
        { label: 'Report Asset Materialization', id: 'report_asset_materialization' },
        { label: 'Wipe Asset', id: 'wipe_asset' },
      ],
      value: () => 'launch_run',
    },

    // ── Repository selectors (launch_run + schedule/sensor operations) ─────────
    {
      id: 'repositoryLocationName',
      title: 'Repository Location',
      type: 'short-input',
      placeholder: 'e.g., my_code_location',
      condition: {
        field: 'operation',
        value: [
          'launch_run',
          'list_schedules',
          'start_schedule',
          'list_sensors',
          'start_sensor',
          'materialize_assets',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'launch_run',
          'list_schedules',
          'start_schedule',
          'list_sensors',
          'start_sensor',
          'materialize_assets',
        ],
      },
    },
    {
      id: 'repositoryName',
      title: 'Repository Name',
      type: 'short-input',
      placeholder: 'e.g., __repository__',
      condition: {
        field: 'operation',
        value: [
          'launch_run',
          'list_schedules',
          'start_schedule',
          'list_sensors',
          'start_sensor',
          'materialize_assets',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'launch_run',
          'list_schedules',
          'start_schedule',
          'list_sensors',
          'start_sensor',
          'materialize_assets',
        ],
      },
    },

    // ── Launch Run ─────────────────────────────────────────────────────────────
    {
      id: 'jobName',
      title: 'Job Name',
      type: 'short-input',
      placeholder: 'e.g., my_pipeline_job',
      condition: { field: 'operation', value: 'launch_run' },
      required: { field: 'operation', value: 'launch_run' },
    },
    {
      id: 'runConfigJson',
      title: 'Run Config',
      type: 'code',
      placeholder: '{"ops": {"my_op": {"config": {"key": "value"}}}}',
      condition: { field: 'operation', value: 'launch_run' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate a Dagster run config JSON object based on the user's description.

Examples:
- "set partition date to 2024-01-15" -> {"ops": {"load_partition": {"config": {"partition_date": "2024-01-15"}}}}
- "run with debug logging" -> {"execution": {"multiprocess": {"config": {"max_concurrent": 1}}}}

Return ONLY a valid JSON object - no explanations, no extra text.`,
        placeholder: 'Describe the run configuration...',
        generationType: 'json-object',
      },
    },
    {
      id: 'tags',
      title: 'Tags',
      type: 'code',
      placeholder: '[{"key": "env", "value": "prod"}]',
      condition: { field: 'operation', value: ['launch_run', 'materialize_assets'] },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate a Dagster execution tags JSON array based on the user's description.

Format: [{"key": "string", "value": "string"}, ...]

Examples:
- "tag env as prod" -> [{"key": "env", "value": "prod"}]
- "mark as nightly run owned by data team" -> [{"key": "schedule", "value": "nightly"}, {"key": "owner", "value": "data-team"}]

Return ONLY a valid JSON array - no explanations, no extra text.`,
        placeholder: 'Describe the tags to attach to this run...',
        generationType: 'json-object',
      },
    },

    // ── Run ID (shared: get_run, get_run_logs, terminate_run, delete_run, reexecute_run) ──
    {
      id: 'runId',
      title: 'Run ID',
      type: 'short-input',
      placeholder: 'e.g., abc123def456',
      condition: {
        field: 'operation',
        value: ['get_run', 'get_run_logs', 'terminate_run', 'delete_run', 'reexecute_run'],
      },
      required: {
        field: 'operation',
        value: ['get_run', 'get_run_logs', 'terminate_run', 'delete_run', 'reexecute_run'],
      },
    },

    // ── Reexecute Run ──────────────────────────────────────────────────────────
    {
      id: 'strategy',
      title: 'Reexecution Strategy',
      type: 'dropdown',
      options: [
        { label: 'All Steps', id: 'ALL_STEPS' },
        { label: 'From Failure', id: 'FROM_FAILURE' },
        { label: 'From Asset Failure', id: 'FROM_ASSET_FAILURE' },
      ],
      value: () => 'ALL_STEPS',
      condition: { field: 'operation', value: 'reexecute_run' },
      required: { field: 'operation', value: 'reexecute_run' },
    },

    // ── Get Run Logs ───────────────────────────────────────────────────────────
    {
      id: 'afterCursor',
      title: 'After Cursor',
      type: 'short-input',
      placeholder: 'Cursor from a previous get_run_logs response (for pagination)',
      condition: { field: 'operation', value: 'get_run_logs' },
      mode: 'advanced',
    },
    {
      id: 'logsLimit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '100',
      condition: { field: 'operation', value: 'get_run_logs' },
      mode: 'advanced',
    },

    // ── List Runs ──────────────────────────────────────────────────────────────
    {
      id: 'listRunsJobName',
      title: 'Job Name Filter',
      type: 'short-input',
      placeholder: 'Filter by job name (optional)',
      condition: { field: 'operation', value: 'list_runs' },
    },
    {
      id: 'statuses',
      title: 'Status Filter',
      type: 'short-input',
      placeholder: 'e.g. SUCCESS,FAILURE (optional)',
      condition: { field: 'operation', value: 'list_runs' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate a comma-separated list of Dagster run statuses to filter by.

Valid statuses: QUEUED, NOT_STARTED, STARTING, MANAGED, STARTED, SUCCESS, FAILURE, CANCELING, CANCELED

Examples:
- "only failed runs" -> FAILURE
- "completed runs (success or failure)" -> SUCCESS,FAILURE
- "runs in progress" -> QUEUED,NOT_STARTED,STARTING,STARTED

Return ONLY the comma-separated status values - no explanations, no extra text.`,
        placeholder: 'Describe which run statuses to include...',
      },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '20',
      condition: { field: 'operation', value: 'list_runs' },
      mode: 'advanced',
    },
    {
      id: 'createdAfter',
      title: 'Created After',
      type: 'short-input',
      placeholder: 'Unix timestamp in seconds (optional)',
      condition: { field: 'operation', value: 'list_runs' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Convert the user's description of a start time into a Unix timestamp in seconds.

Return ONLY the integer Unix timestamp in seconds - no explanations, no extra text.`,
        placeholder: 'Describe the earliest creation time...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'createdBefore',
      title: 'Created Before',
      type: 'short-input',
      placeholder: 'Unix timestamp in seconds (optional)',
      condition: { field: 'operation', value: 'list_runs' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Convert the user's description of an end time into a Unix timestamp in seconds.

Return ONLY the integer Unix timestamp in seconds - no explanations, no extra text.`,
        placeholder: 'Describe the latest creation time...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'runsCursor',
      title: 'Cursor',
      type: 'short-input',
      placeholder: 'Run ID from a previous response cursor (for pagination)',
      condition: { field: 'operation', value: 'list_runs' },
      mode: 'advanced',
    },

    // ── Schedule operations ────────────────────────────────────────────────────
    {
      id: 'scheduleName',
      title: 'Schedule Name',
      type: 'short-input',
      placeholder: 'e.g., my_daily_schedule',
      condition: { field: 'operation', value: 'start_schedule' },
      required: { field: 'operation', value: 'start_schedule' },
    },
    {
      id: 'scheduleStatus',
      title: 'Status Filter',
      type: 'dropdown',
      options: [
        { label: 'All', id: '' },
        { label: 'Running', id: 'RUNNING' },
        { label: 'Stopped', id: 'STOPPED' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'list_schedules' },
      mode: 'advanced',
    },

    // ── Sensor operations ──────────────────────────────────────────────────────
    {
      id: 'sensorName',
      title: 'Sensor Name',
      type: 'short-input',
      placeholder: 'e.g., my_asset_sensor',
      condition: { field: 'operation', value: 'start_sensor' },
      required: { field: 'operation', value: 'start_sensor' },
    },
    {
      id: 'sensorStatus',
      title: 'Status Filter',
      type: 'dropdown',
      options: [
        { label: 'All', id: '' },
        { label: 'Running', id: 'RUNNING' },
        { label: 'Stopped', id: 'STOPPED' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'list_sensors' },
      mode: 'advanced',
    },

    // ── Stop schedule / sensor (shared) ────────────────────────────────────────
    {
      id: 'instigationStateId',
      title: 'Instigator State ID',
      type: 'short-input',
      placeholder: 'ID from list_schedules or list_sensors output',
      condition: { field: 'operation', value: ['stop_schedule', 'stop_sensor'] },
      required: { field: 'operation', value: ['stop_schedule', 'stop_sensor'] },
    },

    // ── Asset operations ───────────────────────────────────────────────────────
    {
      id: 'assetKey',
      title: 'Asset Key',
      type: 'short-input',
      placeholder: 'e.g., my_asset or raw/events',
      condition: {
        field: 'operation',
        value: ['get_asset', 'report_asset_materialization', 'wipe_asset'],
      },
      required: {
        field: 'operation',
        value: ['get_asset', 'report_asset_materialization', 'wipe_asset'],
      },
    },
    {
      id: 'assetJobName',
      title: 'Asset Job',
      type: 'short-input',
      placeholder: 'e.g., __ASSET_JOB or a named asset job',
      condition: { field: 'operation', value: 'materialize_assets' },
      required: { field: 'operation', value: 'materialize_assets' },
    },
    {
      id: 'assetSelection',
      title: 'Asset Selection',
      type: 'long-input',
      placeholder: 'Comma- or newline-separated asset keys, e.g. raw/events, summary',
      condition: { field: 'operation', value: 'materialize_assets' },
      required: { field: 'operation', value: 'materialize_assets' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a comma-separated list of Dagster asset keys to materialize based on the user's description. Multi-part keys use slashes (e.g. raw/events).

Return ONLY the comma-separated asset keys - no explanations, no extra text.`,
        placeholder: 'Describe which assets to materialize...',
      },
    },
    {
      id: 'assetPrefix',
      title: 'Key Prefix',
      type: 'short-input',
      placeholder: 'Filter by asset key prefix, e.g. raw (optional)',
      condition: { field: 'operation', value: 'list_assets' },
    },
    {
      id: 'assetsLimit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '100',
      condition: { field: 'operation', value: 'list_assets' },
      mode: 'advanced',
    },
    {
      id: 'assetsCursor',
      title: 'Cursor',
      type: 'short-input',
      placeholder: 'Cursor from a previous list_assets response (for pagination)',
      condition: { field: 'operation', value: 'list_assets' },
      mode: 'advanced',
    },
    {
      id: 'reportEventType',
      title: 'Event Type',
      type: 'dropdown',
      options: [
        { label: 'Materialization', id: 'ASSET_MATERIALIZATION' },
        { label: 'Observation', id: 'ASSET_OBSERVATION' },
      ],
      value: () => 'ASSET_MATERIALIZATION',
      condition: { field: 'operation', value: 'report_asset_materialization' },
    },
    {
      id: 'reportPartitionKeys',
      title: 'Partition Keys',
      type: 'short-input',
      placeholder: 'Comma-separated partition keys (optional)',
      condition: { field: 'operation', value: 'report_asset_materialization' },
      mode: 'advanced',
    },
    {
      id: 'reportDescription',
      title: 'Description',
      type: 'long-input',
      placeholder: 'Description for the reported event (optional)',
      condition: { field: 'operation', value: 'report_asset_materialization' },
      mode: 'advanced',
    },

    // ── Connection (common to all operations) ──────────────────────────────────
    {
      id: 'host',
      title: 'Host',
      type: 'short-input',
      placeholder: 'http://localhost:3001  or  https://myorg.dagster.cloud/prod',
      required: true,
    },
    {
      id: 'apiKey',
      title: 'API Token',
      type: 'short-input',
      placeholder: 'Dagster+ API token (leave blank for OSS / self-hosted)',
      password: true,
    },
  ],

  tools: {
    access: [
      'dagster_launch_run',
      'dagster_get_run',
      'dagster_get_run_logs',
      'dagster_list_runs',
      'dagster_list_jobs',
      'dagster_reexecute_run',
      'dagster_terminate_run',
      'dagster_delete_run',
      'dagster_list_schedules',
      'dagster_start_schedule',
      'dagster_stop_schedule',
      'dagster_list_sensors',
      'dagster_start_sensor',
      'dagster_stop_sensor',
      'dagster_list_assets',
      'dagster_get_asset',
      'dagster_materialize_assets',
      'dagster_report_asset_materialization',
      'dagster_wipe_asset',
    ],
    config: {
      tool: (params) => `dagster_${params.operation}`,
      params: (params) => {
        const result: Record<string, unknown> = {}

        // list_runs: type-coerce limit + time filters, remap job name filter and cursor
        if (params.operation === 'list_runs') {
          result.limit = toFiniteNumber(params.limit)
          result.jobName = params.listRunsJobName || undefined
          result.createdAfter = toFiniteNumber(params.createdAfter)
          result.createdBefore = toFiniteNumber(params.createdBefore)
          result.cursor = params.runsCursor || undefined
        }

        // get_run_logs: remap logsLimit → limit
        if (params.operation === 'get_run_logs') {
          result.limit = toFiniteNumber(params.logsLimit)
        }

        // reexecute_run: remap runId → parentRunId
        if (params.operation === 'reexecute_run') {
          if (params.runId) result.parentRunId = params.runId
        }

        // list_schedules / list_sensors: drop empty status filter
        if (params.operation === 'list_schedules' && !params.scheduleStatus) {
          result.scheduleStatus = undefined
        }
        if (params.operation === 'list_sensors' && !params.sensorStatus) {
          result.sensorStatus = undefined
        }

        // list_assets: type-coerce limit and remap prefix/cursor
        if (params.operation === 'list_assets') {
          result.prefix = params.assetPrefix || undefined
          result.limit = toFiniteNumber(params.assetsLimit)
          result.cursor = params.assetsCursor || undefined
        }

        // materialize_assets: remap asset job name → jobName
        if (params.operation === 'materialize_assets') {
          result.jobName = params.assetJobName
        }

        // report_asset_materialization: remap report-prefixed fields to tool params
        if (params.operation === 'report_asset_materialization') {
          result.eventType = params.reportEventType || 'ASSET_MATERIALIZATION'
          result.partitionKeys = params.reportPartitionKeys || undefined
          result.description = params.reportDescription || undefined
        }

        return result
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    host: { type: 'string', description: 'Dagster host URL' },
    apiKey: {
      type: 'string',
      description: 'Dagster Cloud API token (optional for self-hosted instances)',
    },
    // Launch Run
    repositoryLocationName: { type: 'string', description: 'Repository location name' },
    repositoryName: { type: 'string', description: 'Repository name' },
    jobName: { type: 'string', description: 'Job name to launch' },
    runConfigJson: { type: 'string', description: 'Run configuration as JSON' },
    tags: { type: 'string', description: 'Tags as JSON array of {key, value} objects' },
    // Run ID operations
    runId: { type: 'string', description: 'Run ID' },
    // Reexecute Run
    strategy: {
      type: 'string',
      description: 'Reexecution strategy (ALL_STEPS, FROM_FAILURE, FROM_ASSET_FAILURE)',
    },
    // Get Run Logs
    afterCursor: { type: 'string', description: 'Pagination cursor for run logs' },
    logsLimit: { type: 'number', description: 'Maximum log events to return' },
    // List Runs
    listRunsJobName: { type: 'string', description: 'Filter list_runs by job name' },
    statuses: { type: 'string', description: 'Comma-separated run statuses to filter by' },
    createdAfter: {
      type: 'number',
      description: 'Only return runs created at/after this Unix time',
    },
    createdBefore: {
      type: 'number',
      description: 'Only return runs created at/before this Unix time',
    },
    runsCursor: { type: 'string', description: 'Run ID cursor for list_runs pagination' },
    limit: { type: 'number', description: 'Maximum results to return' },
    // Schedules
    scheduleName: { type: 'string', description: 'Schedule name' },
    scheduleStatus: {
      type: 'string',
      description: 'Filter schedules by status (RUNNING or STOPPED)',
    },
    // Sensors
    sensorName: { type: 'string', description: 'Sensor name' },
    sensorStatus: { type: 'string', description: 'Filter sensors by status (RUNNING or STOPPED)' },
    // Stop schedule / sensor
    instigationStateId: { type: 'string', description: 'InstigationState ID for stop operations' },
    // Assets
    assetKey: { type: 'string', description: 'Slash-delimited asset key' },
    assetJobName: { type: 'string', description: 'Asset job to launch for materialization' },
    assetSelection: {
      type: 'string',
      description: 'Comma/newline-separated asset keys to materialize',
    },
    assetPrefix: { type: 'string', description: 'Filter list_assets by key prefix' },
    assetsLimit: { type: 'number', description: 'Maximum assets to return' },
    assetsCursor: { type: 'string', description: 'Cursor for list_assets pagination' },
    reportEventType: {
      type: 'string',
      description: 'Runless event type (ASSET_MATERIALIZATION or ASSET_OBSERVATION)',
    },
    reportPartitionKeys: {
      type: 'string',
      description: 'Comma-separated partition keys for the reported event',
    },
    reportDescription: { type: 'string', description: 'Description for the reported event' },
  },

  outputs: {
    // Launch Run / Reexecute Run / Delete Run / Get Run
    runId: { type: 'string', description: 'Run ID' },
    // Get Run
    jobName: { type: 'string', description: 'Job name the run belongs to' },
    status: { type: 'string', description: 'Run or schedule/sensor status' },
    mode: { type: 'string', description: 'Execution mode of the run' },
    startTime: { type: 'number', description: 'Run start time (Unix timestamp)' },
    endTime: { type: 'number', description: 'Run end time (Unix timestamp)' },
    creationTime: { type: 'number', description: 'Run creation time (Unix timestamp)' },
    updateTime: { type: 'number', description: 'Run last-update time (Unix timestamp)' },
    parentRunId: { type: 'string', description: 'Immediate parent run ID (re-executions)' },
    rootRunId: { type: 'string', description: 'Root run ID of the re-execution group' },
    canTerminate: { type: 'boolean', description: 'Whether the run can be terminated' },
    runConfigYaml: { type: 'string', description: 'Run configuration as YAML' },
    tags: { type: 'json', description: 'Run tags as array of {key, value} objects' },
    // List Runs
    runs: {
      type: 'json',
      description: 'List of runs (runId, jobName, status, tags, startTime, endTime)',
    },
    // List Jobs
    jobs: { type: 'json', description: 'List of jobs (name, repositoryName)' },
    // Terminate Run
    success: { type: 'boolean', description: 'Whether termination succeeded' },
    message: { type: 'string', description: 'Termination status or error message' },
    // Get Run Logs
    events: {
      type: 'json',
      description: 'Log events (type, message, timestamp, level, stepKey, eventType)',
    },
    cursor: {
      type: 'string',
      description: 'Pagination cursor for the next page (logs, runs, or assets)',
    },
    hasMore: {
      type: 'boolean',
      description: 'Whether more items are available beyond this page',
    },
    // List Schedules
    schedules: {
      type: 'json',
      description:
        'List of schedules (name, cronSchedule, jobName, status, id, description, executionTimezone)',
    },
    // List Sensors
    sensors: {
      type: 'json',
      description: 'List of sensors (name, sensorType, status, id, description)',
    },
    // Start/Stop schedule or sensor
    id: { type: 'string', description: 'Instigator state ID of the schedule or sensor' },
    // Get Run / Get Asset (asset key selection)
    assetSelection: { type: 'json', description: 'Asset keys targeted by the run' },
    // List Assets
    assets: { type: 'json', description: 'List of assets (assetKey, path)' },
    // Get Asset
    assetKey: { type: 'string', description: 'Slash-joined asset key' },
    path: { type: 'json', description: 'Asset key path segments' },
    groupName: { type: 'string', description: 'Asset group name' },
    description: { type: 'string', description: 'Asset description' },
    jobNames: { type: 'json', description: 'Jobs that can materialize the asset' },
    computeKind: { type: 'string', description: 'Asset compute kind tag' },
    isPartitioned: { type: 'boolean', description: 'Whether the asset is partitioned' },
    latestMaterialization: {
      type: 'json',
      description: 'Latest materialization (runId, timestamp, partition, stepKey)',
    },
  },
}
