import { createLogger } from '@sim/logger'
import { DEFAULT_EXECUTION_TIMEOUT_MS } from '@/lib/core/execution-limits'
import type { BrightDataDiscoverParams, BrightDataDiscoverResponse } from '@/tools/brightdata/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('tools:brightdata:discover')

const POLL_INTERVAL_MS = 3000
const MAX_POLL_TIME_MS = DEFAULT_EXECUTION_TIMEOUT_MS

export const brightDataDiscoverTool: ToolConfig<
  BrightDataDiscoverParams,
  BrightDataDiscoverResponse
> = {
  id: 'brightdata_discover',
  name: 'Bright Data Discover',
  description:
    'AI-powered web discovery that finds and ranks results by intent. Returns up to 1,000 results with optional cleaned page content for RAG and verification.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Bright Data API token',
    },
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The search query (e.g., "competitor pricing changes enterprise plan")',
    },
    numResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results to return, up to 1000. Defaults to 10',
    },
    intent: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Describes what the agent is trying to accomplish, used to rank results by relevance (e.g., "find official pricing pages and change notes")',
    },
    includeContent: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to include cleaned page content in results',
    },
    format: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Response format: "json" or "markdown". Defaults to "json"',
    },
    language: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search language code (e.g., "en", "es", "fr"). Defaults to "en"',
    },
    country: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Two-letter ISO country code for localized results (e.g., "us", "gb")',
    },
  },

  request: {
    method: 'POST',
    url: 'https://api.brightdata.com/discover',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        query: params.query,
      }
      if (params.numResults) body.num_results = params.numResults
      if (params.intent) body.intent = params.intent
      if (params.includeContent != null) body.include_content = params.includeContent
      if (params.format) body.format = params.format
      if (params.language) body.language = params.language
      if (params.country) body.country = params.country
      return body
    },
  },

  transformResponse: async (response: Response, params) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(errorText || `Discover request failed with status ${response.status}`)
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        results: [],
        query: params?.query ?? null,
        totalResults: 0,
        taskId: data.task_id ?? null,
      },
    }
  },

  postProcess: async (result, params) => {
    if (!result.success) return result

    const taskId = result.output.taskId
    if (!taskId) {
      return {
        ...result,
        success: false,
        error: 'Discover API did not return a task_id. Cannot poll for results.',
      }
    }

    logger.info(`Bright Data Discover task ${taskId} created, polling for results...`)

    let elapsedTime = 0

    while (elapsedTime < MAX_POLL_TIME_MS) {
      try {
        const pollResponse = await fetch(
          `https://api.brightdata.com/discover?task_id=${encodeURIComponent(taskId)}`,
          {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${params.apiKey}`,
            },
          }
        )

        if (!pollResponse.ok) {
          return {
            ...result,
            success: false,
            error: `Failed to poll discover results: ${pollResponse.statusText}`,
          }
        }

        const data = await pollResponse.json()
        logger.info(`Bright Data Discover task ${taskId} status: ${data.status}`)

        if (data.status === 'done') {
          const items = Array.isArray(data.results) ? data.results : []

          const results = items.map((item: Record<string, unknown>) => ({
            url: (item.link as string) ?? (item.url as string) ?? null,
            title: (item.title as string) ?? null,
            description: (item.description as string) ?? (item.snippet as string) ?? null,
            relevanceScore: (item.relevance_score as number) ?? null,
            content: (item.content as string) ?? null,
          }))

          return {
            success: true,
            output: {
              results,
              query: params.query ?? null,
              totalResults: results.length,
            },
          }
        }

        if (data.status === 'failed' || data.status === 'error') {
          return {
            ...result,
            success: false,
            error: `Discover task failed: ${data.error ?? 'Unknown error'}`,
          }
        }

        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
        elapsedTime += POLL_INTERVAL_MS
      } catch (error) {
        logger.error('Error polling for discover task:', {
          message: error instanceof Error ? error.message : String(error),
          taskId,
        })

        return {
          ...result,
          success: false,
          error: `Error polling for discover task: ${error instanceof Error ? error.message : String(error)}`,
        }
      }
    }

    logger.warn(
      `Discover task ${taskId} did not complete within the maximum polling time (${MAX_POLL_TIME_MS / 1000}s)`
    )

    return {
      ...result,
      success: false,
      error: `Discover task ${taskId} timed out after ${MAX_POLL_TIME_MS / 1000}s. Check status manually.`,
    }
  },

  outputs: {
    results: {
      type: 'array',
      description: 'Array of discovered web results ranked by intent relevance',
      items: {
        type: 'object',
        description: 'A discovered result',
        properties: {
          url: { type: 'string', description: 'URL of the discovered page', optional: true },
          title: { type: 'string', description: 'Page title', optional: true },
          description: {
            type: 'string',
            description: 'Page description or snippet',
            optional: true,
          },
          relevanceScore: {
            type: 'number',
            description: 'AI-calculated relevance score for intent-based ranking',
            optional: true,
          },
          content: {
            type: 'string',
            description:
              'Cleaned page content in the requested format (when includeContent is true)',
            optional: true,
          },
        },
      },
    },
    query: { type: 'string', description: 'The search query that was executed', optional: true },
    totalResults: { type: 'number', description: 'Total number of results returned' },
  },
}
