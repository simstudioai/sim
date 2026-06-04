import type { DagsterListAssetsParams, DagsterListAssetsResponse } from '@/tools/dagster/types'
import {
  dagsterGraphqlUrl,
  dagsterRequestHeaders,
  dagsterUnionErrorMessage,
  parseAssetKeyPath,
  parseDagsterGraphqlResponse,
} from '@/tools/dagster/utils'
import type { ToolConfig } from '@/tools/types'

/** Default page size applied when the caller omits `limit`, so paging stays bounded and `hasMore` is meaningful. */
const DEFAULT_LIST_ASSETS_LIMIT = 100

/** Shape of each asset node in the `assetsOrError` → `AssetConnection.nodes` selection set. */
interface DagsterAssetGraphqlNode {
  key: { path: string[] }
}

const LIST_ASSETS_QUERY = `
  query ListAssets($cursor: String, $limit: Int, $prefix: [String!]) {
    assetsOrError(cursor: $cursor, limit: $limit, prefix: $prefix) {
      ... on AssetConnection {
        nodes {
          key {
            path
          }
        }
        cursor
      }
      ... on PythonError {
        __typename
        message
      }
    }
  }
`

export const listAssetsTool: ToolConfig<DagsterListAssetsParams, DagsterListAssetsResponse> = {
  id: 'dagster_list_assets',
  name: 'Dagster List Assets',
  description: 'List assets tracked by a Dagster instance, optionally filtered by key prefix.',
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
    prefix: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Slash-delimited asset key prefix to filter by, e.g. "raw" or "raw/events" (optional)',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Asset key cursor from a previous response, for pagination (optional)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of assets to return per page (default 100)',
    },
  },

  request: {
    url: (params) => dagsterGraphqlUrl(params.host),
    method: 'POST',
    headers: (params) => dagsterRequestHeaders(params),
    body: (params) => {
      const pageSize = params.limit ?? DEFAULT_LIST_ASSETS_LIMIT
      // Request one extra row so `hasMore` is exact even when the final page is exactly `pageSize` long.
      const variables: Record<string, unknown> = { limit: pageSize + 1 }
      if (params.prefix) variables.prefix = parseAssetKeyPath(params.prefix)
      if (params.cursor) variables.cursor = params.cursor
      return { query: LIST_ASSETS_QUERY, variables }
    },
  },

  transformResponse: async (response: Response, params?: DagsterListAssetsParams) => {
    const data = await parseDagsterGraphqlResponse<{ assetsOrError?: unknown }>(response)

    const result = data.data?.assetsOrError as
      | { nodes?: DagsterAssetGraphqlNode[]; cursor?: string | null; message?: string }
      | undefined
    if (!result) throw new Error('Unexpected response from Dagster')

    if (!Array.isArray(result.nodes)) {
      throw new Error(dagsterUnionErrorMessage(result, 'List assets failed'))
    }

    const pageSize = params?.limit ?? DEFAULT_LIST_ASSETS_LIMIT
    const hasMore = result.nodes.length > pageSize
    const pageNodes = hasMore ? result.nodes.slice(0, pageSize) : result.nodes

    const assets = pageNodes.map((node) => ({
      assetKey: node.key.path.join('/'),
      path: node.key.path,
    }))

    // Asset cursors are the JSON-serialized key path; Dagster normalizes JS/Python whitespace on the
    // way back in, so we derive the cursor from the last RETURNED asset (not the extra probe row).
    const lastPath = pageNodes.length > 0 ? pageNodes[pageNodes.length - 1].key.path : null

    return {
      success: true,
      output: {
        assets,
        cursor: lastPath ? JSON.stringify(lastPath) : null,
        hasMore,
      },
    }
  },

  outputs: {
    assets: {
      type: 'json',
      description: 'Array of assets (assetKey, path)',
      properties: {
        assetKey: { type: 'string', description: 'Slash-joined asset key' },
        path: { type: 'json', description: 'Asset key path segments' },
      },
    },
    cursor: {
      type: 'string',
      description: 'Cursor to pass on the next call to fetch more assets',
      optional: true,
    },
    hasMore: {
      type: 'boolean',
      description: 'Whether more assets are likely available beyond this page',
    },
  },
}
