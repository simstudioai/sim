import { TinybirdIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { TinybirdResponse } from '@/tools/tinybird/types'

export const TinybirdBlock: BlockConfig<TinybirdResponse> = {
  type: 'tinybird',
  name: 'Tinybird',
  description: 'Send events and query data with Tinybird',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Interact with Tinybird using the Events API to stream JSON or NDJSON events, or use the Query API to execute SQL queries against Pipes and Data Sources.',
  docsLink: 'https://www.tinybird.co/docs/api-reference',
  category: 'tools',
  integrationType: IntegrationType.Analytics,
  bgColor: '#2EF598',
  icon: TinybirdIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Send Events', id: 'tinybird_events' },
        { label: 'Query', id: 'tinybird_query' },
      ],
      value: () => 'tinybird_events',
    },
    {
      id: 'base_url',
      title: 'Base URL',
      type: 'short-input',
      placeholder: 'https://api.tinybird.co',
      required: true,
    },
    {
      id: 'token',
      title: 'API Token',
      type: 'short-input',
      placeholder: 'Enter your Tinybird API token',
      password: true,
      required: true,
    },
    // Send Events operation inputs
    {
      id: 'datasource',
      title: 'Data Source',
      type: 'short-input',
      placeholder: 'my_events_datasource',
      condition: { field: 'operation', value: 'tinybird_events' },
      required: true,
    },
    {
      id: 'data',
      title: 'Data',
      type: 'code',
      placeholder:
        '{"event": "click", "timestamp": "2024-01-01T12:00:00Z"}\n{"event": "view", "timestamp": "2024-01-01T12:00:01Z"}',
      condition: { field: 'operation', value: 'tinybird_events' },
      required: true,
    },
    {
      id: 'format',
      title: 'Format',
      type: 'dropdown',
      options: [
        { label: 'NDJSON (Newline-delimited JSON)', id: 'ndjson' },
        { label: 'JSON', id: 'json' },
      ],
      value: () => 'ndjson',
      condition: { field: 'operation', value: 'tinybird_events' },
    },
    {
      id: 'compression',
      title: 'Compression',
      type: 'dropdown',
      options: [
        { label: 'None', id: 'none' },
        { label: 'Gzip', id: 'gzip' },
      ],
      value: () => 'none',
      mode: 'advanced',
      condition: { field: 'operation', value: 'tinybird_events' },
    },
    {
      id: 'wait',
      title: 'Wait for Acknowledgment',
      type: 'switch',
      value: () => 'false',
      mode: 'advanced',
      condition: { field: 'operation', value: 'tinybird_events' },
    },
    // Query operation inputs
    {
      id: 'query',
      title: 'SQL Query',
      type: 'code',
      placeholder: 'SELECT * FROM my_pipe FORMAT JSON\nOR\nSELECT * FROM my_pipe FORMAT CSV',
      condition: { field: 'operation', value: 'tinybird_query' },
      required: true,
    },
    {
      id: 'pipeline',
      title: 'Pipeline Name',
      type: 'short-input',
      placeholder: 'my_pipe (optional)',
      condition: { field: 'operation', value: 'tinybird_query' },
    },
  ],
  tools: {
    access: ['tinybird_events', 'tinybird_query'],
    config: {
      tool: (params) => params.operation || 'tinybird_events',
      params: (params) => {
        const operation = params.operation || 'tinybird_events'
        const result: Record<string, any> = {
          base_url: params.base_url,
          token: params.token,
        }

        if (operation === 'tinybird_events') {
          // Send Events operation
          if (!params.datasource) {
            throw new Error('Data Source is required for Send Events operation')
          }
          if (!params.data) {
            throw new Error('Data is required for Send Events operation')
          }

          result.datasource = params.datasource
          result.data = params.data
          result.format = params.format || 'ndjson'
          result.compression = params.compression || 'none'

          // Convert wait from string to boolean
          // Convert wait from string to boolean
          if (params.wait !== undefined) {
            const waitValue =
              typeof params.wait === 'string' ? params.wait.toLowerCase() : params.wait
            result.wait = waitValue === 'true' || waitValue === true
          }
        } else if (operation === 'tinybird_query') {
          // Query operation
          if (!params.query) {
            throw new Error('SQL Query is required for Query operation')
          }

          result.query = params.query
          if (params.pipeline) {
            result.pipeline = params.pipeline
          }
        }

        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    base_url: { type: 'string', description: 'Tinybird API base URL' },
    // Send Events inputs
    datasource: {
      type: 'string',
      description: 'Name of the Tinybird Data Source',
    },
    data: {
      type: 'string',
      description: 'Data to send as JSON or NDJSON string',
    },
    wait: { type: 'boolean', description: 'Wait for database acknowledgment' },
    format: {
      type: 'string',
      description: 'Format of the events (ndjson or json)',
    },
    compression: {
      type: 'string',
      description: 'Compression format (none or gzip)',
    },
    // Query inputs
    query: { type: 'string', description: 'SQL query to execute' },
    pipeline: { type: 'string', description: 'Optional pipeline name' },
    // Common
    token: { type: 'string', description: 'Tinybird API Token' },
  },
  outputs: {
    // Send Events outputs
    successful_rows: {
      type: 'number',
      description: 'Number of rows successfully ingested',
    },
    quarantined_rows: {
      type: 'number',
      description: 'Number of rows quarantined (failed validation)',
    },
    // Query outputs
    data: {
      type: 'json',
      description:
        'Query result data. FORMAT JSON: array of objects. Other formats (CSV, TSV, etc.): raw text string.',
    },
    rows: { type: 'number', description: 'Number of rows returned (only with FORMAT JSON)' },
    statistics: {
      type: 'json',
      description:
        'Query execution statistics - elapsed time, rows read, bytes read (only with FORMAT JSON)',
    },
  },
}

export const TinybirdBlockMeta = {
  tags: ['data-warehouse', 'data-analytics'],
  templates: [
    {
      icon: TinybirdIcon,
      title: 'Tinybird pipe-as-API endpoint',
      prompt:
        'Create a workflow that calls a Tinybird published pipe with parameters on a schedule, normalizes the results, and writes them into a Sim table for downstream consumers.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['analysis', 'sync'],
    },
    {
      icon: TinybirdIcon,
      title: 'Tinybird realtime metric watcher',
      prompt:
        'Build a workflow that polls a Tinybird pipe every minute for a realtime KPI, compares against a rolling baseline, and pages PagerDuty when the metric crosses a SLO threshold.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'monitoring'],
      alsoIntegrations: ['pagerduty'],
    },
    {
      icon: TinybirdIcon,
      title: 'Tinybird user-segment exporter',
      prompt:
        'Create a workflow that calls a Tinybird published endpoint with segment parameters, writes the user list to a table, and feeds it to a Loops campaign for targeted activation messaging.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'sync'],
      alsoIntegrations: ['loops'],
    },
    {
      icon: TinybirdIcon,
      title: 'Tinybird usage-meter dashboard',
      prompt:
        'Build a workflow that exposes a Tinybird endpoint reporting per-customer usage for billing, refreshes a Sim table hourly, and surfaces top consumers to Slack.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: TinybirdIcon,
      title: 'Tinybird funnel analytics digest',
      prompt:
        'Create a scheduled workflow that queries a Tinybird pipe for daily signup, activation, and conversion counts, calculates step-over-step drop-off, and posts a funnel digest with week-over-week deltas to the growth Slack channel.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['analysis', 'reporting', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: TinybirdIcon,
      title: 'Tinybird anomaly investigator',
      prompt:
        'Build a workflow triggered by an alert that calls a Tinybird pipe to pull the surrounding event data for the affected metric, has an agent summarize the likely cause, and opens a Linear issue with the supporting query results attached.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'analysis', 'monitoring'],
      alsoIntegrations: ['linear'],
    },
    {
      icon: TinybirdIcon,
      title: 'Tinybird executive KPI report',
      prompt:
        'Create a scheduled weekly workflow that queries several Tinybird pipes for the company’s headline KPIs, assembles them into a Markdown report file with trend commentary, and emails it to the leadership team.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['reporting', 'analysis', 'enterprise'],
      alsoIntegrations: ['gmail'],
    },
  ],
} as const satisfies BlockMeta
