import { DEFAULT_EXECUTION_TIMEOUT_MS } from '@/lib/core/execution-limits'
import type { RunActorParams, RunActorResult } from '@/tools/apify/types'
import type { ToolConfig } from '@/tools/types'

const POLL_INTERVAL_MS = 5000
const MAX_POLL_TIME_MS = DEFAULT_EXECUTION_TIMEOUT_MS

export const apifyRunActorAsyncTool: ToolConfig<RunActorParams, RunActorResult> = {
  id: 'apify_run_actor_async',
  name: 'APIFY Run Actor (Async)',
  description: 'Run an APIFY actor asynchronously with polling for long-running tasks',
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
    waitForFinish: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Initial wait time in seconds (0-60) before polling starts. Example: 30',
    },
    itemLimit: {
      type: 'number',
      required: false,
      default: 100,
      visibility: 'user-or-llm',
      description: 'Max dataset items to fetch (1-250000). Default: 100. Example: 500',
    },
    memory: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Memory in megabytes allocated for the actor run (128-32768). Example: 1024 for 1GB, 2048 for 2GB',
    },
    timeout: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Timeout in seconds for the actor run. Example: 300 for 5 minutes, 3600 for 1 hour',
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
      const encodedActorId = encodeURIComponent(params.actorId)
      const baseUrl = `https://api.apify.com/v2/acts/${encodedActorId}/runs`
      const queryParams = new URLSearchParams()

      queryParams.set('token', params.apiKey)

      if (params.waitForFinish !== undefined) {
        const waitTime = Math.max(0, Math.min(params.waitForFinish, 60))
        queryParams.set('waitForFinish', waitTime.toString())
      }
      if (params.memory) {
        queryParams.set('memory', params.memory.toString())
      }
      if (params.timeout) {
        queryParams.set('timeout', params.timeout.toString())
      }
      if (params.build) {
        queryParams.set('build', params.build)
      }

      return `${baseUrl}?${queryParams.toString()}`
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
        output: { success: false, runId: '', status: 'ERROR' },
        error: `APIFY API error: ${errorText}`,
      }
    }

    const data = await response.json()
    return {
      success: true,
      output: data.data,
    }
  },

  postProcess: async (result, params) => {
    if (!result.success) {
      return result
    }

    const runData = result.output as any
    const runId = runData.id

    let elapsedTime = 0

    while (elapsedTime < MAX_POLL_TIME_MS) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
      elapsedTime += POLL_INTERVAL_MS

      const encodedActorId = encodeURIComponent(params.actorId)
      const statusResponse = await fetch(
        `https://api.apify.com/v2/acts/${encodedActorId}/runs/${runId}?token=${params.apiKey}`,
        {
          headers: {
            Authorization: `Bearer ${params.apiKey}`,
          },
        }
      )

      if (!statusResponse.ok) {
        return {
          success: false,
          output: { success: false, runId, status: 'UNKNOWN' },
          error: 'Failed to fetch run status',
        }
      }

      const statusData = await statusResponse.json()
      const run = statusData.data

      if (
        run.status === 'SUCCEEDED' ||
        run.status === 'FAILED' ||
        run.status === 'ABORTED' ||
        run.status === 'TIMED-OUT'
      ) {
        if (run.status === 'SUCCEEDED') {
          const limit = Math.max(1, Math.min(params.itemLimit || 100, 250000))
          const itemsResponse = await fetch(
            `https://api.apify.com/v2/datasets/${run.defaultDatasetId}/items?token=${params.apiKey}&limit=${limit}`,
            {
              headers: {
                Authorization: `Bearer ${params.apiKey}`,
              },
            }
          )

          if (itemsResponse.ok) {
            const items = await itemsResponse.json()
            return {
              success: true,
              output: {
                success: true,
                runId,
                status: run.status,
                datasetId: run.defaultDatasetId,
                items,
              },
            }
          }
        }

        return {
          success: run.status === 'SUCCEEDED',
          output: {
            success: run.status === 'SUCCEEDED',
            runId,
            status: run.status,
            datasetId: run.defaultDatasetId,
          },
          error: run.status !== 'SUCCEEDED' ? `Actor run ${run.status}` : undefined,
        }
      }
    }

    return {
      success: false,
      output: {
        success: false,
        runId,
        status: 'TIMEOUT',
      },
      error: 'Actor run timed out after 5 minutes of polling',
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the actor run succeeded' },
    runId: { type: 'string', description: 'APIFY run ID' },
    status: { type: 'string', description: 'Run status (SUCCEEDED, FAILED, etc.)' },
    datasetId: { type: 'string', description: 'Dataset ID containing results' },
    items: { type: 'array', description: 'Dataset items (if completed)' },
  },
}
