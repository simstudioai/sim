import type { DagsterGetRunLogsParams, DagsterGetRunLogsResponse } from '@/tools/dagster/types'
import { parseDagsterGraphqlResponse } from '@/tools/dagster/utils'
import type { ToolConfig } from '@/tools/types'

interface DagsterRunEvent {
  __typename?: string
  message?: string
  timestamp?: string
  level?: string
  stepKey?: string | null
  eventType?: string | null
}

interface DagsterEventConnection {
  events?: DagsterRunEvent[]
  cursor?: string
  hasMore?: boolean
}

const GET_RUN_LOGS_QUERY = `
  query GetRunLogs($runId: ID!, $afterCursor: String, $limit: Int) {
    logsForRun(runId: $runId, afterCursor: $afterCursor, limit: $limit) {
      ... on EventConnection {
        events {
          __typename
          ... on MessageEvent {
            message
            timestamp
            level
            stepKey
            eventType
          }
        }
        cursor
        hasMore
      }
      ... on RunNotFoundError {
        __typename
        message
      }
      ... on PythonError {
        __typename
        message
      }
    }
  }
`

export const getRunLogsTool: ToolConfig<DagsterGetRunLogsParams, DagsterGetRunLogsResponse> = {
  id: 'dagster_get_run_logs',
  name: 'Dagster Get Run Logs',
  description: 'Fetch execution event logs for a Dagster run.',
  version: '1.0.0',

  params: {
    host: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description:
        'Dagster host URL (e.g., https://myorg.dagster.cloud/prod or http://localhost:3001)',
    },
    apiKey: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Dagster+ API token (leave blank for OSS / self-hosted)',
    },
    runId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the run to fetch logs for',
    },
    afterCursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cursor for paginating through log events (from a previous response)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of log events to return',
    },
  },

  request: {
    url: (params) => `${params.host.replace(/\/$/, '')}/graphql`,
    method: 'POST',
    headers: (params) => {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (params.apiKey) headers['Dagster-Cloud-Api-Token'] = params.apiKey
      return headers
    },
    body: (params) => {
      const variables: Record<string, unknown> = { runId: params.runId }
      if (params.afterCursor) variables.afterCursor = params.afterCursor
      if (params.limit != null) variables.limit = params.limit
      return { query: GET_RUN_LOGS_QUERY, variables }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await parseDagsterGraphqlResponse<{ logsForRun?: unknown }>(response)

    const result = data.data?.logsForRun as
      | DagsterEventConnection
      | { message?: string }
      | undefined
    if (!result || typeof result !== 'object') throw new Error('Unexpected response from Dagster')

    if (!('events' in result)) {
      const errResult = result as { message?: string }
      throw new Error(errResult.message ?? 'Failed to fetch run logs')
    }

    const conn = result as DagsterEventConnection
    const events = (conn.events ?? []).map((e) => ({
      type: e.__typename ?? 'Unknown',
      message: e.message ?? '',
      timestamp: e.timestamp ?? '',
      level: e.level ?? 'INFO',
      stepKey: e.stepKey ?? null,
      eventType: e.eventType ?? null,
    }))

    return {
      success: true,
      output: {
        events,
        cursor: conn.cursor ?? null,
        hasMore: conn.hasMore ?? false,
      },
    }
  },

  outputs: {
    events: {
      type: 'json',
      description: 'Array of log events (type, message, timestamp, level, stepKey, eventType)',
      properties: {
        type: { type: 'string', description: 'GraphQL typename of the event' },
        message: { type: 'string', description: 'Human-readable log message' },
        timestamp: { type: 'string', description: 'Event timestamp as a Unix epoch string' },
        level: { type: 'string', description: 'Log level (DEBUG, INFO, WARNING, ERROR, CRITICAL)' },
        stepKey: {
          type: 'string',
          description: 'Step key, if the event is step-scoped',
          optional: true,
        },
        eventType: { type: 'string', description: 'Dagster event type enum value', optional: true },
      },
    },
    cursor: {
      type: 'string',
      description: 'Cursor for fetching the next page of log events',
      optional: true,
    },
    hasMore: {
      type: 'boolean',
      description: 'Whether more log events are available beyond this page',
    },
  },
}
