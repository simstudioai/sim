import type { DagsterGetAssetParams, DagsterGetAssetResponse } from '@/tools/dagster/types'
import {
  dagsterGraphqlUrl,
  dagsterRequestHeaders,
  parseAssetKeyPath,
  parseDagsterGraphqlResponse,
} from '@/tools/dagster/utils'
import type { ToolConfig } from '@/tools/types'

/** Fields selected on `assetOrError` when the union resolves to `Asset`. */
interface DagsterGetAssetGraphqlAsset {
  key: { path: string[] }
  definition: {
    groupName: string | null
    description: string | null
    jobNames: string[] | null
    computeKind: string | null
    isPartitioned: boolean | null
  } | null
  assetMaterializations: Array<{
    runId: string
    timestamp: string
    partition: string | null
    stepKey: string | null
  }> | null
}

const GET_ASSET_QUERY = `
  query GetAsset($assetKey: AssetKeyInput!) {
    assetOrError(assetKey: $assetKey) {
      ... on Asset {
        key {
          path
        }
        definition {
          groupName
          description
          jobNames
          computeKind
          isPartitioned
        }
        assetMaterializations(limit: 1) {
          runId
          timestamp
          partition
          stepKey
        }
      }
      ... on AssetNotFoundError {
        __typename
        message
      }
    }
  }
`

export const getAssetTool: ToolConfig<DagsterGetAssetParams, DagsterGetAssetResponse> = {
  id: 'dagster_get_asset',
  name: 'Dagster Get Asset',
  description: 'Get an asset definition and its latest materialization by asset key.',
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
      description: 'Slash-delimited asset key, e.g. "my_asset" or "raw/events"',
    },
  },

  request: {
    url: (params) => dagsterGraphqlUrl(params.host),
    method: 'POST',
    headers: (params) => dagsterRequestHeaders(params),
    body: (params) => ({
      query: GET_ASSET_QUERY,
      variables: { assetKey: { path: parseAssetKeyPath(params.assetKey) } },
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await parseDagsterGraphqlResponse<{ assetOrError?: unknown }>(response)

    const raw = data.data?.assetOrError
    if (!raw || typeof raw !== 'object') throw new Error('Unexpected response from Dagster')

    if (!('key' in raw)) {
      const errResult = raw as { message?: string }
      throw new Error(errResult.message ?? 'Asset not found')
    }

    const asset = raw as DagsterGetAssetGraphqlAsset
    const latest = asset.assetMaterializations?.[0] ?? null

    return {
      success: true,
      output: {
        assetKey: asset.key.path.join('/'),
        path: asset.key.path,
        groupName: asset.definition?.groupName ?? null,
        description: asset.definition?.description ?? null,
        jobNames: asset.definition?.jobNames ?? null,
        computeKind: asset.definition?.computeKind ?? null,
        isPartitioned: asset.definition?.isPartitioned ?? null,
        latestMaterialization: latest
          ? {
              runId: latest.runId,
              timestamp: latest.timestamp,
              partition: latest.partition ?? null,
              stepKey: latest.stepKey ?? null,
            }
          : null,
      },
    }
  },

  outputs: {
    assetKey: { type: 'string', description: 'Slash-joined asset key' },
    path: { type: 'json', description: 'Asset key path segments' },
    groupName: {
      type: 'string',
      description: 'Asset group the definition belongs to',
      optional: true,
    },
    description: { type: 'string', description: 'Asset description', optional: true },
    jobNames: {
      type: 'json',
      description: 'Names of jobs that can materialize this asset',
      optional: true,
    },
    computeKind: {
      type: 'string',
      description: 'Compute kind tag (e.g., python, dbt, spark)',
      optional: true,
    },
    isPartitioned: {
      type: 'boolean',
      description: 'Whether the asset is partitioned',
      optional: true,
    },
    latestMaterialization: {
      type: 'json',
      description: 'Most recent materialization (runId, timestamp, partition, stepKey)',
      optional: true,
      properties: {
        runId: { type: 'string', description: 'Run that produced the materialization' },
        timestamp: { type: 'string', description: 'Materialization timestamp (epoch ms string)' },
        partition: { type: 'string', description: 'Partition key, if partitioned', optional: true },
        stepKey: { type: 'string', description: 'Step key that emitted it', optional: true },
      },
    },
  },
}
