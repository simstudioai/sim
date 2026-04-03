import { DagsterIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { IntegrationType } from '@/blocks/types'
import type { DagsterResponse } from '@/tools/dagster/types'

export const DagsterBlock: BlockConfig<DagsterResponse> = {
  type: 'dagster',
  name: 'Dagster',
  description: 'Orchestrate data pipelines and manage job runs with Dagster',
  longDescription:
    'Connect to a Dagster instance to launch job runs, monitor run status, list available jobs across repositories, and terminate in-progress runs. API token only required for Dagster+.',
  docsLink: 'https://docs.sim.ai/tools/dagster',
  category: 'tools',
  integrationType: IntegrationType.Automation,
  tags: ['data-analytics', 'automation'],
  bgColor: '#191A23',
  icon: DagsterIcon,

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Launch Run', id: 'launch_run' },
        { label: 'Get Run', id: 'get_run' },
        { label: 'List Runs', id: 'list_runs' },
        { label: 'List Jobs', id: 'list_jobs' },
        { label: 'Terminate Run', id: 'terminate_run' },
      ],
      value: () => 'launch_run',
    },

    // ── Launch Run ──
    {
      id: 'repositoryLocationName',
      title: 'Repository Location',
      type: 'short-input',
      placeholder: 'e.g., my_code_location',
      condition: { field: 'operation', value: 'launch_run' },
      required: { field: 'operation', value: 'launch_run' },
    },
    {
      id: 'repositoryName',
      title: 'Repository Name',
      type: 'short-input',
      placeholder: 'e.g., __repository__',
      condition: { field: 'operation', value: 'launch_run' },
      required: { field: 'operation', value: 'launch_run' },
    },
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
    },

    // ── Get Run / Terminate Run ──
    {
      id: 'runId',
      title: 'Run ID',
      type: 'short-input',
      placeholder: 'e.g., abc123def456',
      condition: { field: 'operation', value: ['get_run', 'terminate_run'] },
      required: { field: 'operation', value: ['get_run', 'terminate_run'] },
    },

    // ── List Runs ──
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
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '20',
      condition: { field: 'operation', value: 'list_runs' },
      mode: 'advanced',
    },

    // ── Connection (common) ──
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
      'dagster_list_runs',
      'dagster_list_jobs',
      'dagster_terminate_run',
    ],
    config: {
      tool: (params) => `dagster_${params.operation}`,
      params: (params) => {
        const result: Record<string, unknown> = {}
        if (params.limit) result.limit = Number(params.limit)
        // Map list_runs job name filter to the correct param
        if (params.listRunsJobName) result.jobName = params.listRunsJobName
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
    repositoryLocationName: { type: 'string', description: 'Repository location name' },
    repositoryName: { type: 'string', description: 'Repository name' },
    jobName: { type: 'string', description: 'Job name to launch' },
    runConfigJson: { type: 'string', description: 'Run configuration as JSON' },
    tags: { type: 'string', description: 'Tags as JSON array of {key, value} objects' },
    runId: { type: 'string', description: 'Run ID' },
    listRunsJobName: { type: 'string', description: 'Filter list_runs by job name' },
    statuses: { type: 'string', description: 'Comma-separated run statuses to filter by' },
    limit: { type: 'number', description: 'Maximum results to return' },
  },

  outputs: {
    // Launch Run
    runId: { type: 'string', description: 'Launched or queried run ID' },
    // Get Run
    jobName: { type: 'string', description: 'Job name the run belongs to' },
    status: { type: 'string', description: 'Run status' },
    startTime: { type: 'number', description: 'Run start time (Unix timestamp)' },
    endTime: { type: 'number', description: 'Run end time (Unix timestamp)' },
    runConfigYaml: { type: 'string', description: 'Run configuration as YAML' },
    tags: { type: 'json', description: 'Run tags as array of {key, value} objects' },
    // List Runs
    runs: { type: 'json', description: 'List of runs' },
    // List Jobs
    jobs: { type: 'json', description: 'List of jobs across all repositories' },
    // Terminate Run
    success: { type: 'boolean', description: 'Whether termination succeeded' },
    message: { type: 'string', description: 'Termination status or error message' },
  },
}
