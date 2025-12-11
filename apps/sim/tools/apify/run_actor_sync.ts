import type { ToolConfig } from '@/tools/types'
import type { RunActorParams, RunActorResult } from './types'

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
      description: 'Actor ID or username/actor-name (e.g., "janedoe/my-actor" or actor ID)',
    },
    input: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Actor input as JSON string. See actor documentation for required fields.',
    },
    timeout: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Timeout in seconds (default: actor default)',
    },
    build: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Actor build to run (e.g., "latest", "beta", or build tag/number)',
    },
  },

  request: {
    url: (params) => {
      const encodedActorId = encodeURIComponent(params.actorId)
      const baseUrl = `https://api.apify.com/v2/acts/${encodedActorId}/run-sync-get-dataset-items`
      const queryParams = new URLSearchParams()

      queryParams.set('token', params.apiKey)

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
        output: { success: false, runId: '', status: 'ERROR', items: [] },
        error: `APIFY API error: ${errorText}`,
      }
    }

    const items = await response.json()
    return {
      success: true,
      output: {
        success: true,
        runId: 'sync-execution',
        status: 'SUCCEEDED',
        items,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the actor run succeeded' },
    runId: { type: 'string', description: 'APIFY run ID' },
    status: { type: 'string', description: 'Run status (SUCCEEDED, FAILED, etc.)' },
    items: { type: 'array', description: 'Dataset items (if completed)' },
  },
}
