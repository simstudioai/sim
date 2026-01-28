import { TinybirdIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
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
