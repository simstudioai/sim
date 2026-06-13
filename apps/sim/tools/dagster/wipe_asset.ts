import type { DagsterWipeAssetParams, DagsterWipeAssetResponse } from '@/tools/dagster/types'
import {
  dagsterGraphqlUrl,
  dagsterRequestHeaders,
  dagsterUnionErrorMessage,
  parseAssetKeyPath,
  parseDagsterGraphqlResponse,
} from '@/tools/dagster/utils'
import type { ToolConfig } from '@/tools/types'

interface WipeAssetResult {
  type: string
  assetPartitionRanges?: Array<{ assetKey: { path: string[] } }>
  message?: string
}

const WIPE_ASSET_MUTATION = `
  mutation WipeAsset($assetPartitionRanges: [PartitionsByAssetSelector!]!) {
    wipeAssets(assetPartitionRanges: $assetPartitionRanges) {
      type: __typename
      ... on AssetWipeSuccess {
        assetPartitionRanges {
          assetKey {
            path
          }
        }
      }
      ... on AssetNotFoundError {
        message
      }
      ... on UnauthorizedError {
        message
      }
      ... on UnsupportedOperationError {
        message
      }
      ... on PythonError {
        message
      }
    }
  }
`

export const wipeAssetTool: ToolConfig<DagsterWipeAssetParams, DagsterWipeAssetResponse> = {
  id: 'dagster_wipe_asset',
  name: 'Dagster Wipe Asset',
  description:
    'DESTRUCTIVE: permanently wipes ALL materialization history (every partition) for an asset. This cannot be undone.',
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
      description: 'Slash-delimited asset key to wipe, e.g. "my_asset" or "raw/events"',
    },
  },

  request: {
    url: (params) => dagsterGraphqlUrl(params.host),
    method: 'POST',
    headers: (params) => dagsterRequestHeaders(params),
    body: (params) => ({
      query: WIPE_ASSET_MUTATION,
      variables: {
        assetPartitionRanges: [{ assetKey: { path: parseAssetKeyPath(params.assetKey) } }],
      },
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await parseDagsterGraphqlResponse<{ wipeAssets?: unknown }>(response)

    const result = data.data?.wipeAssets as WipeAssetResult | undefined
    if (!result) throw new Error('Unexpected response from Dagster')

    if (result.type === 'AssetWipeSuccess') {
      const wipedKey = result.assetPartitionRanges?.[0]?.assetKey.path.join('/') ?? ''
      return {
        success: true,
        output: {
          success: true,
          assetKey: wipedKey,
        },
      }
    }

    throw new Error(`${result.type}: ${dagsterUnionErrorMessage(result, 'Wipe asset failed')}`)
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the asset was wiped successfully',
    },
    assetKey: {
      type: 'string',
      description: 'Slash-joined asset key that was wiped',
    },
  },
}
