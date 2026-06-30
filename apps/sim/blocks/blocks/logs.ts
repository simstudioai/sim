import { Library } from '@sim/emcn/icons'
import { fetchWorkspaceWorkflowOptions } from '@/lib/workflows/subblocks/options'
import type { BlockConfig } from '@/blocks/types'

export const LogsBlock: BlockConfig = {
  type: 'logs',
  name: 'Logs',
  hideFromToolbar: true,
  description: 'Query workflow execution logs',
  longDescription:
    'Search workflow execution logs in the current workspace, fetch a single log by id, or load full execution details with the per-block state snapshot.',
  bgColor: '#EAB308',
  bestPractices: `
  - The block always operates on the current workspace; you cannot query other workspaces.
  - 'Query Logs' returns summary rows. To get a full log entry (executionData, files), use 'Get Log by ID' on a row's id.
  - Use 'Get Execution Details' (with an executionId) to inspect per-block state for a single run.
  - Pagination is cursor-based: pass the previous response's nextCursor as Cursor to fetch the next page.
  `,
  icon: Library,
  category: 'blocks',
  docsLink: 'https://docs.sim.ai/api-reference/logs/getExecutionDetails',
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Query Logs', id: 'query' },
        { label: 'Get Log by ID', id: 'get_log' },
        { label: 'Get Execution Details', id: 'get_execution' },
      ],
      placeholder: 'Select operation',
      value: () => 'query',
    },
    {
      id: 'workflowIds',
      title: 'Workflow IDs',
      type: 'short-input',
      placeholder: 'Comma-separated workflow IDs',
      condition: { field: 'operation', value: 'query' },
    },
    {
      id: 'executionId',
      title: 'Execution ID',
      type: 'short-input',
      placeholder: 'Filter by a single execution ID',
      condition: { field: 'operation', value: 'query' },
    },
    {
      id: 'level',
      title: 'Level',
      type: 'dropdown',
      options: [
        { label: 'All', id: 'all' },
        { label: 'Info', id: 'info' },
        { label: 'Error', id: 'error' },
        { label: 'Running', id: 'running' },
        { label: 'Pending', id: 'pending' },
      ],
      value: () => 'all',
      condition: { field: 'operation', value: 'query' },
    },
    {
      id: 'triggers',
      title: 'Triggers',
      type: 'short-input',
      placeholder: 'api,webhook,schedule,manual,chat,mothership',
      condition: { field: 'operation', value: 'query' },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '100 (max 200)',
      condition: { field: 'operation', value: 'query' },
    },
    {
      id: 'startDate',
      title: 'Start Date',
      type: 'short-input',
      placeholder: 'ISO 8601 timestamp',
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an ISO 8601 timestamp from the user description. Return ONLY the timestamp string.',
        generationType: 'timestamp',
      },
      condition: { field: 'operation', value: 'query' },
    },
    {
      id: 'endDate',
      title: 'End Date',
      type: 'short-input',
      placeholder: 'ISO 8601 timestamp',
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an ISO 8601 timestamp from the user description. Return ONLY the timestamp string.',
        generationType: 'timestamp',
      },
      condition: { field: 'operation', value: 'query' },
    },
    {
      id: 'search',
      title: 'Search',
      type: 'short-input',
      placeholder: 'Free-text search',
      mode: 'advanced',
      condition: { field: 'operation', value: 'query' },
    },
    {
      id: 'sortBy',
      title: 'Sort By',
      type: 'dropdown',
      options: [
        { label: 'Date', id: 'date' },
        { label: 'Duration', id: 'duration' },
        { label: 'Cost', id: 'cost' },
        { label: 'Status', id: 'status' },
      ],
      value: () => 'date',
      mode: 'advanced',
      condition: { field: 'operation', value: 'query' },
    },
    {
      id: 'sortOrder',
      title: 'Sort Order',
      type: 'dropdown',
      options: [
        { label: 'Descending', id: 'desc' },
        { label: 'Ascending', id: 'asc' },
      ],
      value: () => 'desc',
      mode: 'advanced',
      condition: { field: 'operation', value: 'query' },
    },
    {
      id: 'cursor',
      title: 'Cursor',
      type: 'short-input',
      placeholder: 'nextCursor from a previous response',
      mode: 'advanced',
      condition: { field: 'operation', value: 'query' },
    },
    {
      id: 'logId',
      title: 'Log ID',
      type: 'short-input',
      placeholder: 'Log entry ID',
      condition: { field: 'operation', value: 'get_log' },
      required: true,
    },
    {
      id: 'executionIdLookup',
      title: 'Execution ID',
      type: 'short-input',
      placeholder: 'Execution ID',
      condition: { field: 'operation', value: 'get_execution' },
      required: true,
    },
  ],
  tools: {
    access: ['logs_query', 'logs_get', 'logs_get_execution'],
    config: {
      tool: (params: Record<string, any>) => {
        const operation = params.operation || 'query'
        if (operation === 'get_log') return 'logs_get'
        if (operation === 'get_execution') return 'logs_get_execution'
        return 'logs_query'
      },
      params: (params: Record<string, any>) => {
        const operation = params.operation || 'query'

        if (operation === 'get_log') {
          if (!params.logId) {
            throw new Error('Logs Block Error: Log ID is required for get_log operation')
          }
          return { id: params.logId }
        }

        if (operation === 'get_execution') {
          if (!params.executionIdLookup) {
            throw new Error(
              'Logs Block Error: Execution ID is required for get_execution operation'
            )
          }
          return { executionId: params.executionIdLookup }
        }

        const rawLimit =
          params.limit !== undefined && params.limit !== null && params.limit !== ''
            ? Number(params.limit)
            : undefined
        const limit = Number.isFinite(rawLimit) ? rawLimit : undefined

        return {
          workflowIds: params.workflowIds || undefined,
          executionId: params.executionId || undefined,
          level: params.level && params.level !== 'all' ? params.level : undefined,
          triggers: params.triggers || undefined,
          limit,
          startDate: params.startDate || undefined,
          endDate: params.endDate || undefined,
          search: params.search || undefined,
          cursor: params.cursor || undefined,
          sortBy: params.sortBy || undefined,
          sortOrder: params.sortOrder || undefined,
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    workflowIds: { type: 'string', description: 'Comma-separated workflow IDs' },
    executionId: { type: 'string', description: 'Execution ID filter (query operation)' },
    level: { type: 'string', description: 'Log level filter' },
    triggers: { type: 'string', description: 'Comma-separated triggers' },
    limit: { type: 'number', description: 'Max logs to return (default 100, max 200)' },
    startDate: { type: 'string', description: 'ISO 8601 lower bound' },
    endDate: { type: 'string', description: 'ISO 8601 upper bound' },
    search: { type: 'string', description: 'Free-text search term' },
    sortBy: { type: 'string', description: "'date' | 'duration' | 'cost' | 'status'" },
    sortOrder: { type: 'string', description: "'desc' | 'asc'" },
    cursor: { type: 'string', description: 'Pagination cursor' },
    logId: { type: 'string', description: 'Log entry ID (get_log operation)' },
    executionIdLookup: {
      type: 'string',
      description: 'Execution ID (get_execution operation)',
    },
  },
  outputs: {
    logs: { type: 'json', description: 'Array of log summary entries (query operation)' },
    nextCursor: {
      type: 'string',
      description: 'Cursor for next page; null when no more results (query operation)',
    },
    log: { type: 'json', description: 'Full log entry (get_log operation)' },
    executionId: { type: 'string', description: 'Execution ID (get_execution operation)' },
    workflowId: { type: 'string', description: 'Workflow ID (get_execution operation)' },
    workflowState: {
      type: 'json',
      description: 'Per-block state snapshot (get_execution operation)',
    },
    childWorkflowSnapshots: {
      type: 'json',
      description: 'Snapshots for child workflows (get_execution operation)',
    },
    executionMetadata: {
      type: 'json',
      description: 'Trigger, timestamps, totalDurationMs, cost (get_execution operation)',
    },
  },
}

const COMPARISON_OPERATOR_OPTIONS = [
  { label: '=', id: '=' },
  { label: '>', id: '>' },
  { label: '<', id: '<' },
  { label: '>=', id: '>=' },
  { label: '<=', id: '<=' },
  { label: '!=', id: '!=' },
]

/** Preset time windows mirroring the Logs page time-range filter. */
const TIME_RANGE_MS: Record<string, number> = {
  'past-30-minutes': 30 * 60 * 1000,
  'past-hour': 60 * 60 * 1000,
  'past-6-hours': 6 * 60 * 60 * 1000,
  'past-12-hours': 12 * 60 * 60 * 1000,
  'past-24-hours': 24 * 60 * 60 * 1000,
  'past-3-days': 3 * 24 * 60 * 60 * 1000,
  'past-7-days': 7 * 24 * 60 * 60 * 1000,
  'past-14-days': 14 * 24 * 60 * 60 * 1000,
  'past-30-days': 30 * 24 * 60 * 60 * 1000,
}

/** Normalizes multi-select arrays or comma strings into a comma-separated string. */
function joinIds(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    const ids = value.filter((id): id is string => typeof id === 'string' && id.length > 0)
    return ids.length > 0 ? ids.join(',') : undefined
  }
  if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  return undefined
}

export const LogsV2Block: BlockConfig = {
  type: 'logs_v2',
  name: 'Logs',
  description: 'Query workflow runs and fetch run details',
  longDescription:
    'Query workflow run logs in the current workspace with the same filters as the Logs page, returning matching run IDs. Fetch full details for a single run, including its trace spans.',
  bgColor: '#EAB308',
  bestPractices: `
  - The block always operates on the current workspace; you cannot query other workspaces.
  - 'Query Logs' returns only run IDs, ordered by the sort settings (newest first by default). Feed an ID into 'Get Run Details' for the full picture.
  - 'Get Run Details' returns the run summary plus the full trace spans (per-block inputs, outputs, and timings).
  - Cost filters and outputs are denominated in credits.
  `,
  icon: Library,
  category: 'blocks',
  docsLink: 'https://docs.sim.ai/integrations/logs',
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Query Logs', id: 'query' },
        { label: 'Get Run Details', id: 'get_run_details' },
      ],
      value: () => 'query',
    },
    {
      id: 'workflowSelector',
      title: 'Workflows',
      type: 'dropdown',
      multiSelect: true,
      options: [],
      placeholder: 'All workflows',
      description: 'Only include runs of these workflows. Leave empty for all.',
      mode: 'basic',
      canonicalParamId: 'workflowIds',
      condition: { field: 'operation', value: 'query' },
      fetchOptions: () => fetchWorkspaceWorkflowOptions(),
    },
    {
      id: 'manualWorkflowIds',
      title: 'Workflow IDs',
      type: 'short-input',
      placeholder: 'Comma-separated workflow IDs',
      mode: 'advanced',
      canonicalParamId: 'workflowIds',
      condition: { field: 'operation', value: 'query' },
    },
    {
      id: 'level',
      title: 'Status',
      type: 'dropdown',
      multiSelect: true,
      options: [
        { label: 'Info', id: 'info' },
        { label: 'Error', id: 'error' },
        { label: 'Running', id: 'running' },
        { label: 'Pending', id: 'pending' },
        { label: 'Cancelled', id: 'cancelled' },
      ],
      placeholder: 'All statuses',
      condition: { field: 'operation', value: 'query' },
    },
    {
      id: 'timeRange',
      title: 'Time Range',
      type: 'dropdown',
      options: [
        { label: 'All time', id: 'all-time' },
        { label: 'Past 30 minutes', id: 'past-30-minutes' },
        { label: 'Past hour', id: 'past-hour' },
        { label: 'Past 6 hours', id: 'past-6-hours' },
        { label: 'Past 12 hours', id: 'past-12-hours' },
        { label: 'Past 24 hours', id: 'past-24-hours' },
        { label: 'Past 3 days', id: 'past-3-days' },
        { label: 'Past 7 days', id: 'past-7-days' },
        { label: 'Past 14 days', id: 'past-14-days' },
        { label: 'Past 30 days', id: 'past-30-days' },
      ],
      value: () => 'all-time',
      condition: { field: 'operation', value: 'query' },
    },
    {
      id: 'startDate',
      title: 'Start Date',
      type: 'short-input',
      placeholder: 'ISO 8601 timestamp (overrides Time Range)',
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an ISO 8601 timestamp from the user description. Return ONLY the timestamp string.',
        generationType: 'timestamp',
      },
      condition: { field: 'operation', value: 'query' },
    },
    {
      id: 'endDate',
      title: 'End Date',
      type: 'short-input',
      placeholder: 'ISO 8601 timestamp',
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an ISO 8601 timestamp from the user description. Return ONLY the timestamp string.',
        generationType: 'timestamp',
      },
      condition: { field: 'operation', value: 'query' },
    },
    {
      id: 'costOperator',
      title: 'Cost Comparison',
      type: 'dropdown',
      options: COMPARISON_OPERATOR_OPTIONS,
      value: () => '>=',
      mode: 'advanced',
      condition: { field: 'operation', value: 'query' },
    },
    {
      id: 'costValue',
      title: 'Cost (credits)',
      type: 'short-input',
      placeholder: 'e.g. 10',
      mode: 'advanced',
      condition: { field: 'operation', value: 'query' },
    },
    {
      id: 'durationOperator',
      title: 'Duration Comparison',
      type: 'dropdown',
      options: COMPARISON_OPERATOR_OPTIONS,
      value: () => '>=',
      mode: 'advanced',
      condition: { field: 'operation', value: 'query' },
    },
    {
      id: 'durationValue',
      title: 'Duration (ms)',
      type: 'short-input',
      placeholder: 'e.g. 30000',
      mode: 'advanced',
      condition: { field: 'operation', value: 'query' },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '100 (max 200)',
      condition: { field: 'operation', value: 'query' },
    },
    {
      id: 'sortBy',
      title: 'Sort By',
      type: 'dropdown',
      options: [
        { label: 'Date', id: 'date' },
        { label: 'Duration', id: 'duration' },
        { label: 'Cost', id: 'cost' },
        { label: 'Status', id: 'status' },
      ],
      value: () => 'date',
      mode: 'advanced',
      condition: { field: 'operation', value: 'query' },
    },
    {
      id: 'sortOrder',
      title: 'Sort Order',
      type: 'dropdown',
      options: [
        { label: 'Descending', id: 'desc' },
        { label: 'Ascending', id: 'asc' },
      ],
      value: () => 'desc',
      mode: 'advanced',
      condition: { field: 'operation', value: 'query' },
    },
    {
      id: 'runId',
      title: 'Run ID',
      type: 'short-input',
      placeholder: 'd864be57-0aa0-43b1-8fc3-e4ebb680572d',
      condition: { field: 'operation', value: 'get_run_details' },
      required: true,
    },
  ],
  tools: {
    access: ['logs_query_runs', 'logs_get_run_details'],
    config: {
      tool: (params: Record<string, any>) => {
        const operation = params.operation || 'query'
        if (operation === 'get_run_details') return 'logs_get_run_details'
        return 'logs_query_runs'
      },
      params: (params: Record<string, any>) => {
        const operation = params.operation || 'query'

        if (operation === 'get_run_details') {
          if (!params.runId) {
            throw new Error('Logs Block Error: Run ID is required for Get Run Details')
          }
          return { runId: params.runId }
        }

        const toNumber = (value: unknown): number | undefined => {
          if (value === undefined || value === null || value === '') return undefined
          const parsed = Number(value)
          return Number.isFinite(parsed) ? parsed : undefined
        }

        const timeRangeMs = TIME_RANGE_MS[params.timeRange]
        const presetStartDate = timeRangeMs
          ? new Date(Date.now() - timeRangeMs).toISOString()
          : undefined

        const level = joinIds(params.level)
        const costValue = toNumber(params.costValue)
        const durationValue = toNumber(params.durationValue)

        return {
          workflowIds: joinIds(params.workflowIds),
          level,
          startDate: params.startDate || presetStartDate,
          endDate: params.endDate || undefined,
          costOperator: costValue !== undefined ? params.costOperator || undefined : undefined,
          costValue,
          durationOperator:
            durationValue !== undefined ? params.durationOperator || undefined : undefined,
          durationValue,
          limit: toNumber(params.limit),
          sortBy: params.sortBy || undefined,
          sortOrder: params.sortOrder || undefined,
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    workflowIds: { type: 'array', description: 'Workflow IDs to filter by (canonical param)' },
    level: { type: 'array', description: 'Statuses to include (empty for all)' },
    timeRange: { type: 'string', description: 'Preset time window' },
    startDate: { type: 'string', description: 'ISO 8601 lower bound (overrides Time Range)' },
    endDate: { type: 'string', description: 'ISO 8601 upper bound' },
    costOperator: { type: 'string', description: "Cost comparison operator ('=', '>', …)" },
    costValue: { type: 'number', description: 'Cost threshold in credits' },
    durationOperator: {
      type: 'string',
      description: "Duration comparison operator ('=', '>', …)",
    },
    durationValue: { type: 'number', description: 'Duration threshold in milliseconds' },
    limit: { type: 'number', description: 'Max run IDs to return (default 100, max 200)' },
    sortBy: { type: 'string', description: "'date' | 'duration' | 'cost' | 'status'" },
    sortOrder: { type: 'string', description: "'desc' | 'asc'" },
    runId: { type: 'string', description: 'Run ID (Get Run Details operation)' },
  },
  outputs: {
    runIds: {
      type: 'array',
      description: 'IDs of the runs matching the filters',
      condition: { field: 'operation', value: 'query' },
    },
    runId: {
      type: 'string',
      description: 'The run ID',
      condition: { field: 'operation', value: 'get_run_details' },
    },
    workflowId: {
      type: 'string',
      description: 'Workflow ID this run belongs to',
      condition: { field: 'operation', value: 'get_run_details' },
    },
    workflowName: {
      type: 'string',
      description: 'Workflow name',
      condition: { field: 'operation', value: 'get_run_details' },
    },
    status: {
      type: 'string',
      description: 'Run status',
      condition: { field: 'operation', value: 'get_run_details' },
    },
    trigger: {
      type: 'string',
      description: 'How the run was triggered',
      condition: { field: 'operation', value: 'get_run_details' },
    },
    startedAt: {
      type: 'string',
      description: 'Run start time (ISO 8601)',
      condition: { field: 'operation', value: 'get_run_details' },
    },
    durationMs: {
      type: 'number',
      description: 'Run duration in milliseconds',
      condition: { field: 'operation', value: 'get_run_details' },
    },
    cost: {
      type: 'number',
      description: 'Run cost in credits',
      condition: { field: 'operation', value: 'get_run_details' },
    },
    traceSpans: {
      type: 'array',
      description: 'Full trace spans for the run',
      condition: { field: 'operation', value: 'get_run_details' },
    },
    finalOutput: {
      type: 'json',
      description: 'Final output of the run',
      condition: { field: 'operation', value: 'get_run_details' },
    },
  },
}
