import type {
  BrightDataCancelSnapshotParams,
  BrightDataCancelSnapshotResponse,
} from '@/tools/brightdata/types'
import type { ToolConfig } from '@/tools/types'

export const brightDataCancelSnapshotTool: ToolConfig<
  BrightDataCancelSnapshotParams,
  BrightDataCancelSnapshotResponse
> = {
  id: 'brightdata_cancel_snapshot',
  name: 'Bright Data Cancel Snapshot',
  description:
    'Cancel an active Bright Data scraping job using its snapshot ID. Terminates data collection in progress.',
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
      description: 'The snapshot ID of the collection to cancel (e.g., "s_m4x7enmven8djfqak")',
    },
  },

  request: {
    method: 'POST',
    url: (params) =>
      `https://api.brightdata.com/datasets/v3/snapshot/${params.snapshotId?.trim()}/cancel`,
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(errorText || `Cancel snapshot failed with status ${response.status}`)
    }

    const data = (await response.json().catch(() => null)) as Record<string, unknown> | null
    return {
      success: true,
      output: {
        snapshotId: (data?.snapshot_id as string) ?? null,
        cancelled: true,
      },
    }
  },

  outputs: {
    snapshotId: {
      type: 'string',
      description: 'The snapshot ID that was cancelled',
      optional: true,
    },
    cancelled: {
      type: 'boolean',
      description: 'Whether the cancellation was successful',
    },
  },
}
