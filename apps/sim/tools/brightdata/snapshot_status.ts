import type {
  BrightDataSnapshotStatusParams,
  BrightDataSnapshotStatusResponse,
} from '@/tools/brightdata/types'
import type { ToolConfig } from '@/tools/types'

export const brightDataSnapshotStatusTool: ToolConfig<
  BrightDataSnapshotStatusParams,
  BrightDataSnapshotStatusResponse
> = {
  id: 'brightdata_snapshot_status',
  name: 'Bright Data Snapshot Status',
  description:
    'Check the progress of an async Bright Data scraping job. Returns status: starting, running, ready, or failed.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Bright Data API token',
    },
    snapshotId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The snapshot ID returned when the collection was triggered (e.g., "s_m4x7enmven8djfqak")',
    },
  },

  request: {
    method: 'GET',
    url: (params) => `https://api.brightdata.com/datasets/v3/progress/${params.snapshotId?.trim()}`,
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(errorText || `Snapshot status check failed with status ${response.status}`)
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        snapshotId: data.snapshot_id ?? null,
        datasetId: data.dataset_id ?? null,
        status: data.status ?? 'unknown',
      },
    }
  },

  outputs: {
    snapshotId: {
      type: 'string',
      description: 'The snapshot ID that was queried',
    },
    datasetId: {
      type: 'string',
      description: 'The dataset ID associated with this snapshot',
      optional: true,
    },
    status: {
      type: 'string',
      description: 'Current status of the snapshot: "starting", "running", "ready", or "failed"',
    },
  },
}
