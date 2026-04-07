import { DagsterIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { IntegrationType } from '@/blocks/types'
import type { DagsterResponse } from '@/tools/dagster/types'

export const DagsterBlock: BlockConfig<DagsterResponse> = {
  type: 'dagster',
  name: 'Dagster',
  description: 'Orchestrate data pipelines and manage job runs with Dagster',
  longDescription:
    'Connect to a Dagster instance to launch job runs, monitor run status, list available jobs across repositories, terminate or delete runs, reexecute failed runs, fetch run logs, and manage schedules and sensors. API token only required for Dagster+.',
  docsLink: 'https://docs.sim.ai/tools/dagster',
  category: 'tools',
  integrationType: IntegrationType.Automation,
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
        value: ['launch_run', 'list_schedules', 'start_schedule', 'list_sensors', 'start_sensor'],
      },
      required: {
        field: 'operation',
        value: ['launch_run', 'list_schedules', 'start_schedule', 'list_sensors', 'start_sensor'],
      },
    },
    {
      id: 'repositoryName',
      title: 'Repository Name',
      type: 'short-input',
      placeholder: 'e.g., __repository__',
      condition: {
        field: 'operation',
        value: ['launch_run', 'list_schedules', 'start_schedule', 'list_sensors', 'start_sensor'],
      },
      required: {
        field: 'operation',
        value: ['launch_run', 'list_schedules', 'start_schedule', 'list_sensors', 'start_sensor'],
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
      condition: { field: 'operation', value: 'launch_run' },
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
    ],
    config: {
      tool: (params) => `dagster_${params.operation}`,
      params: (params) => {
        const result: Record<string, unknown> = {}

        // list_runs: type-coerce limit and remap job name filter
        if (params.operation === 'list_runs') {
          if (params.limit != null && params.limit !== '') result.limit = Number(params.limit)
          result.jobName = params.listRunsJobName || undefined
        }

        // get_run_logs: remap logsLimit → limit
        if (params.operation === 'get_run_logs') {
          if (params.logsLimit != null && params.logsLimit !== '')
            result.limit = Number(params.logsLimit)
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
  },

  outputs: {
    // Launch Run / Reexecute Run / Delete Run / Get Run
    runId: { type: 'string', description: 'Run ID' },
    // Get Run
    jobName: { type: 'string', description: 'Job name the run belongs to' },
    status: { type: 'string', description: 'Run or schedule/sensor status' },
    startTime: { type: 'number', description: 'Run start time (Unix timestamp)' },
    endTime: { type: 'number', description: 'Run end time (Unix timestamp)' },
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
    cursor: { type: 'string', description: 'Pagination cursor for the next page of logs' },
    hasMore: {
      type: 'boolean',
      description: 'Whether more log events are available beyond this page',
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
  },
}
