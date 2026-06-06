import type {
  DagsterReportAssetMaterializationParams,
  DagsterReportAssetMaterializationResponse,
} from '@/tools/dagster/types'
import {
  dagsterGraphqlUrl,
  dagsterRequestHeaders,
  dagsterUnionErrorMessage,
  parseAssetKeyPath,
  parseDagsterGraphqlResponse,
} from '@/tools/dagster/utils'
import type { ToolConfig } from '@/tools/types'

interface ReportAssetEventResult {
  type: string
  assetKey?: { path: string[] }
  message?: string
}

const REPORT_ASSET_EVENT_MUTATION = `
  mutation ReportRunlessAssetEvents($eventParams: ReportRunlessAssetEventsParams!) {
    reportRunlessAssetEvents(eventParams: $eventParams) {
      type: __typename
      ... on ReportRunlessAssetEventsSuccess {
        assetKey {
          path
        }
      }
      ... on UnauthorizedError {
        message
      }
      ... on PythonError {
        message
      }
    }
  }
`

export const reportAssetMaterializationTool: ToolConfig<
  DagsterReportAssetMaterializationParams,
  DagsterReportAssetMaterializationResponse
> = {
  id: 'dagster_report_asset_materialization',
  name: 'Dagster Report Asset Materialization',
  description: 'Report an external (runless) materialization or observation for an asset.',
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
    assetKey: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Slash-delimited asset key to report against, e.g. "my_asset" or "raw/events"',
    },
    eventType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Event type to report: ASSET_MATERIALIZATION (default) or ASSET_OBSERVATION',
    },
    partitionKeys: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated partition keys to report against (optional)',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Human-readable description for the reported event (optional)',
    },
  },

  request: {
    url: (params) => dagsterGraphqlUrl(params.host),
    method: 'POST',
    headers: (params) => dagsterRequestHeaders(params),
    body: (params) => {
      const eventParams: Record<string, unknown> = {
        eventType: params.eventType || 'ASSET_MATERIALIZATION',
        assetKey: { path: parseAssetKeyPath(params.assetKey) },
      }
      if (params.partitionKeys) {
        eventParams.partitionKeys = params.partitionKeys
          .split(',')
          .map((key) => key.trim())
          .filter(Boolean)
      }
      if (params.description) eventParams.description = params.description

      return { query: REPORT_ASSET_EVENT_MUTATION, variables: { eventParams } }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await parseDagsterGraphqlResponse<{ reportRunlessAssetEvents?: unknown }>(response)

    const result = data.data?.reportRunlessAssetEvents as ReportAssetEventResult | undefined
    if (!result) throw new Error('Unexpected response from Dagster')

    if (result.type === 'ReportRunlessAssetEventsSuccess' && result.assetKey) {
      return {
        success: true,
        output: {
          success: true,
          assetKey: result.assetKey.path.join('/'),
        },
      }
    }

    throw new Error(
      `${result.type}: ${dagsterUnionErrorMessage(result, 'Report asset event failed')}`
    )
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the event was reported successfully',
    },
    assetKey: {
      type: 'string',
      description: 'Slash-joined asset key the event was reported against',
    },
  },
}
