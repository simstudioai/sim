import type {
  BrightDataDownloadSnapshotParams,
  BrightDataDownloadSnapshotResponse,
} from '@/tools/brightdata/types'
import type { ToolConfig } from '@/tools/types'

export const brightDataDownloadSnapshotTool: ToolConfig<
  BrightDataDownloadSnapshotParams,
  BrightDataDownloadSnapshotResponse
> = {
  id: 'brightdata_download_snapshot',
  name: 'Bright Data Download Snapshot',
  description:
    'Download the results of a completed Bright Data scraping job using its snapshot ID. The snapshot must have ready status.',
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
    format: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Output format: "json", "ndjson", "jsonl", or "csv". Defaults to "json"',
    },
    compress: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to compress the results',
    },
  },

  request: {
    method: 'GET',
    url: (params) => {
      const queryParams = new URLSearchParams()
      if (params.format) queryParams.set('format', params.format)
      if (params.compress) queryParams.set('compress', 'true')
      const qs = queryParams.toString()
      return `https://api.brightdata.com/datasets/v3/snapshot/${params.snapshotId?.trim()}${qs ? `?${qs}` : ''}`
    },
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response: Response, params) => {
    if (response.status === 409) {
      throw new Error(
        'Snapshot is not ready for download. Check the snapshot status first and wait until it is "ready".'
      )
    }

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(errorText || `Snapshot download failed with status ${response.status}`)
    }

    const contentType = response.headers.get('content-type') || ''
    let data: Array<Record<string, unknown>>

    if (contentType.includes('application/json')) {
      const parsed = await response.json()
      data = Array.isArray(parsed) ? parsed : [parsed]
    } else {
      const text = await response.text()
      try {
        const parsed = JSON.parse(text)
        data = Array.isArray(parsed) ? parsed : [parsed]
      } catch {
        data = [{ raw: text }]
      }
    }

    return {
      success: true,
      output: {
        data,
        format: contentType,
        snapshotId: params?.snapshotId ?? null,
      },
    }
  },

  outputs: {
    data: {
      type: 'array',
      description: 'Array of scraped result records',
      items: {
        type: 'json',
        description: 'A scraped record with dataset-specific fields',
      },
    },
    format: {
      type: 'string',
      description: 'The content type of the downloaded data',
    },
    snapshotId: {
      type: 'string',
      description: 'The snapshot ID that was downloaded',
      optional: true,
    },
  },
}
