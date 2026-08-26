import type { RunActorParams, RunActorResult } from '@/tools/apify/types'
import type { ToolConfig } from '@/tools/types'

export const apifyRunActorSyncTool: ToolConfig<RunActorParams, RunActorResult> = {
  id: 'apify_run_actor_sync',
  name: 'APIFY Run Actor (Sync)',
  description: 'Run an APIFY actor synchronously and get results (max 5 minutes)',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'APIFY API token from console.apify.com/account#/integrations',
    },
    actorId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Actor ID or username/actor-name. Examples: "apify/web-scraper", "janedoe/my-actor", "moJRLRc85AitArpNN"',
    },
    input: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Actor input as JSON string. Example: {"startUrls": [{"url": "https://example.com"}], "maxPages": 10}',
    },
    memory: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Memory in megabytes allocated for the actor run (128-32768). Example: 1024 for 1GB, 2048 for 2GB',
    },
    actorTimeout: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Timeout in seconds for the actor run. Use 0 for no timeout. Example: 300 for 5 minutes',
    },
    build: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Actor build to run. Examples: "latest", "beta", "1.2.3", "build-tag-name"',
    },
  },

  request: {
    url: (params) => {
      const encodedActorId = encodeURIComponent(params.actorId.trim())
      const baseUrl = `https://api.apify.com/v2/acts/${encodedActorId}/run-sync-get-dataset-items`
      const queryParams = new URLSearchParams()

      if (params.memory) {
        queryParams.set('memory', params.memory.toString())
      }
      if (params.actorTimeout != null) {
        queryParams.set('timeout', params.actorTimeout.toString())
      }
      if (params.build) {
        queryParams.set('build', params.build)
      }

      const query = queryParams.toString()
      return query ? `${baseUrl}?${query}` : baseUrl
    },
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      let inputData = {}
      if (params.input) {
        try {
          inputData = JSON.parse(params.input)
        } catch (e) {
          throw new Error('Invalid JSON in input parameter')
        }
      }
      return inputData
    },
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      const errorText = await response.text()
      return {
        success: false,
        output: { success: false, status: 'ERROR', items: [] },
        error: `APIFY API error: ${errorText}`,
      }
    }

    const items = await response.json()
    return {
      success: true,
      output: {
        success: true,
        status: 'SUCCEEDED',
        items: Array.isArray(items) ? items : [],
      },
    }
  },

  /**
   * The sync endpoint answers with a bare dataset-items array and documents no run
   * identifier — neither in the body nor in a response header (only the
   * `X-Apify-Pagination-*` family is returned) — so no `runId` is emitted. Wiring a
   * fabricated id into `apify_get_run` would 404 every time.
   */
  outputs: {
    success: { type: 'boolean', description: 'Whether the actor run succeeded' },
    status: { type: 'string', description: 'Run status (SUCCEEDED, FAILED, etc.)' },
    items: { type: 'array', description: 'Dataset items produced by the run' },
  },
}
