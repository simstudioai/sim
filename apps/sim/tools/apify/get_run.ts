import type { ApifyRun, GetRunParams, GetRunResult } from '@/tools/apify/types'
import type { ToolConfig } from '@/tools/types'

export const apifyGetRunTool: ToolConfig<GetRunParams, GetRunResult> = {
  id: 'apify_get_run',
  name: 'APIFY Get Run',
  description: 'Get the status and details of an APIFY actor run',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'APIFY API token from console.apify.com/account#/integrations',
    },
    runId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Actor run ID to fetch. Example: "HG7ML7M8z78YcAPEB"',
    },
  },

  request: {
    url: (params) =>
      `https://api.apify.com/v2/actor-runs/${encodeURIComponent(params.runId.trim())}`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response, params) => {
    if (!response.ok) {
      const errorText = await response.text()
      return {
        success: false,
        output: {
          success: false,
          runId: params?.runId ?? '',
          status: 'ERROR',
          startedAt: null,
          finishedAt: null,
          datasetId: null,
          keyValueStoreId: null,
          stats: null,
        },
        error: `APIFY API error: ${errorText}`,
      }
    }

    const data = await response.json()
    const run = data.data as ApifyRun
    return {
      success: true,
      output: {
        success: true,
        runId: run.id,
        status: run.status,
        startedAt: run.startedAt ?? null,
        finishedAt: run.finishedAt ?? null,
        datasetId: run.defaultDatasetId ?? null,
        keyValueStoreId: run.defaultKeyValueStoreId ?? null,
        stats: run.stats ?? null,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the run was found' },
    runId: { type: 'string', description: 'APIFY run ID' },
    status: { type: 'string', description: 'Run status (READY, RUNNING, SUCCEEDED, FAILED, etc.)' },
    startedAt: {
      type: 'string',
      description: 'When the run started (ISO timestamp)',
      optional: true,
    },
    finishedAt: {
      type: 'string',
      description: 'When the run finished (ISO timestamp)',
      optional: true,
    },
    datasetId: { type: 'string', description: 'Default dataset ID for the run', optional: true },
    keyValueStoreId: {
      type: 'string',
      description: 'Default key-value store ID for the run',
      optional: true,
    },
    stats: { type: 'json', description: 'Run statistics (memory, CPU, duration)', optional: true },
  },
}
