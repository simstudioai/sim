import { gzipSync } from 'zlib'
import { createLogger } from '@sim/logger'
import type { TinybirdEventsParams, TinybirdEventsResponse } from '@/tools/tinybird/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('tinybird-events')

export const eventsTool: ToolConfig<TinybirdEventsParams, TinybirdEventsResponse> = {
  id: 'tinybird_events',
  name: 'Tinybird Events',
  description:
    'Send events to a Tinybird Data Source using the Events API. Supports JSON and NDJSON formats with optional gzip compression.',
  version: '1.0.0',
  errorExtractor: 'nested-error-object',

  params: {
    base_url: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description:
        'Tinybird API base URL (e.g., https://api.tinybird.co or https://api.us-east.tinybird.co)',
    },
    datasource: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Name of the Tinybird Data Source to send events to. Example: "events_raw", "user_analytics"',
    },
    data: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Data to send as NDJSON (newline-delimited JSON) or JSON string. Each event should be a valid JSON object. Example NDJSON: {"user_id": 1, "event": "click"}\\n{"user_id": 2, "event": "view"}',
    },
    wait: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description:
        'Wait for database acknowledgment before responding. Enables safer retries but introduces latency. Defaults to false.',
    },
    format: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Format of the events data: "ndjson" (default) or "json"',
    },
    compression: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Compression format: "none" (default) or "gzip"',
    },
    token: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Tinybird API Token with DATASOURCE:APPEND or DATASOURCE:CREATE scope',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = params.base_url.endsWith('/') ? params.base_url.slice(0, -1) : params.base_url
      const url = new URL(`${baseUrl}/v0/events`)
      url.searchParams.set('name', params.datasource)
      if (params.wait) {
        url.searchParams.set('wait', 'true')
      }
      return url.toString()
    },
    method: 'POST',
    headers: (params) => {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${params.token}`,
      }

      if (params.compression === 'gzip') {
        headers['Content-Encoding'] = 'gzip'
      }

      if (params.format === 'json') {
        headers['Content-Type'] = 'application/json'
      } else {
        headers['Content-Type'] = 'application/x-ndjson'
      }

      return headers
    },
    body: (params) => {
      const data = params.data
      if (params.compression === 'gzip') {
        return gzipSync(Buffer.from(data, 'utf-8'))
      }
      return data
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    logger.info('Successfully sent events to Tinybird', {
      successful: data.successful_rows,
      quarantined: data.quarantined_rows,
    })

    return {
      success: true,
      output: {
        successful_rows: data.successful_rows ?? 0,
        quarantined_rows: data.quarantined_rows ?? 0,
      },
    }
  },

  outputs: {
    successful_rows: {
      type: 'number',
      description: 'Number of rows successfully ingested',
    },
    quarantined_rows: {
      type: 'number',
      description: 'Number of rows quarantined (failed validation)',
    },
  },
}
