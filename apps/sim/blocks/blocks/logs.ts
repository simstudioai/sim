import { Library } from '@/components/emcn/icons'
import type { BlockConfig } from '@/blocks/types'

export const LogsBlock: BlockConfig = {
  type: 'logs',
  name: 'Logs',
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
