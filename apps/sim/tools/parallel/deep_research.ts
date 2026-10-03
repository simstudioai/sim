import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { DEFAULT_EXECUTION_TIMEOUT_MS } from '@/lib/core/execution-limits'
import { PlatformEvents } from '@/lib/core/telemetry'
import { toList } from '@/tools/parallel/search'
import type { ParallelDeepResearchParams } from '@/tools/parallel/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

const logger = createLogger('ParallelDeepResearchTool')

/**
 * Dollar cost of one Parallel Task run per processor tier.
 *
 * Fast variants are priced identically to their standard counterparts, so both
 * spellings are listed — the block exposes `pro-fast` and `ultra-fast`, and an
 * unlisted tier would silently fall back to the cheapest rate.
 *
 * Source: https://docs.parallel.ai/getting-started/pricing
 */
const PROCESSOR_COST_USD: Record<string, number> = {
  lite: 0.005,
  'lite-fast': 0.005,
  base: 0.01,
  'base-fast': 0.01,
  core: 0.025,
  'core-fast': 0.025,
  core2x: 0.05,
  'core2x-fast': 0.05,
  pro: 0.1,
  'pro-fast': 0.1,
  ultra: 0.3,
  'ultra-fast': 0.3,
  ultra2x: 0.6,
  'ultra2x-fast': 0.6,
  ultra4x: 1.2,
  'ultra4x-fast': 1.2,
  ultra8x: 2.4,
  'ultra8x-fast': 2.4,
}

/**
 * Tier used when the caller does not pick one. Shared by the request body and
 * the cost calculation so the tier Sim asks for is always the tier it charges.
 */
const DEFAULT_PROCESSOR = 'pro'

/**
 * Longest the result endpoint may block before returning 408. Parallel caps a
 * single wait at one hour; Sim's own execution budget is usually the tighter
 * bound, so the wait never outlives the workflow run that is waiting on it.
 */
const RESULT_TIMEOUT_SECONDS = Math.min(3600, Math.ceil(DEFAULT_EXECUTION_TIMEOUT_MS / 1000))

export const deepResearchTool: ToolConfig<ParallelDeepResearchParams, ToolResponse> = {
  id: 'parallel_deep_research',
  name: 'Parallel AI Deep Research',
  description:
    'Conduct comprehensive deep research across the web using Parallel AI. Synthesizes information from multiple sources with citations. Can take up to 45 minutes to complete.',
  version: '1.0.0',

  hosting: {
    envKeyPrefix: 'PARALLEL_API_KEY',
    apiKeyParam: 'apiKey',
    byokProviderId: 'parallel_ai',
    pricing: {
      type: 'custom',
      getCost: (params, _output) => {
        const processor = (params.processor as string) || DEFAULT_PROCESSOR
        const fallbackCost = PROCESSOR_COST_USD[DEFAULT_PROCESSOR]
        const knownCost = PROCESSOR_COST_USD[processor]
        if (knownCost == null) {
          logger.warn(
            `Unknown Parallel processor "${processor}", using default processor cost $${fallbackCost}`
          )
          PlatformEvents.hostedKeyUnknownModelCost({
            toolId: 'parallel_deep_research',
            modelName: processor,
            defaultCost: fallbackCost,
          })
        }
        const cost = knownCost ?? fallbackCost
        return { cost, metadata: { processor, defaultProcessorCost: fallbackCost } }
      },
    },
    rateLimit: {
      mode: 'per_request',
      requestsPerMinute: 10,
    },
  },

  params: {
    input: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Research query or question (up to 15,000 characters)',
    },
    output_format: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Output format: text for a markdown report with inline citations, auto for a structured JSON object that needs the pro tier or higher (default: text)',
    },
    processor: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: `Processing tier: core, core2x, pro, ultra, ultra2x, ultra4x, ultra8x, or a -fast variant (default: ${DEFAULT_PROCESSOR})`,
    },
    include_domains: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Comma-separated list of domains to restrict research to (source policy)',
    },
    exclude_domains: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Comma-separated list of domains to exclude from research (source policy)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Parallel AI API Key',
    },
  },

  request: {
    modelInput: {
      mode: 'project',
      select: (params) => ({ input: params.input }),
    },
    url: 'https://api.parallel.ai/v1/tasks/runs',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      'x-api-key': params.apiKey,
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        input: params.input,
        processor: params.processor || DEFAULT_PROCESSOR,
        task_spec: {
          output_schema: { type: params.output_format === 'auto' ? 'auto' : 'text' },
        },
        enable_events: false,
      }

      const sourcePolicy: Record<string, string[]> = {}
      const includeDomains = toList(params.include_domains)
      const excludeDomains = toList(params.exclude_domains)
      if (includeDomains.length > 0) sourcePolicy.include_domains = includeDomains
      if (excludeDomains.length > 0) sourcePolicy.exclude_domains = excludeDomains
      if (Object.keys(sourcePolicy).length > 0) body.source_policy = sourcePolicy

      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(
        `Parallel AI deep research task creation failed: ${response.status} - ${errorText}`
      )
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        run_id: data.run_id ?? null,
        status: data.status ?? null,
        message: `Research task ${data.status ?? 'created'}, waiting for completion...`,
        content: {},
        basis: [],
      },
    }
  },

  postProcess: async (result, params) => {
    if (!result.success) {
      return result
    }

    const runId = result.output.run_id
    if (!runId) {
      return {
        ...result,
        success: false,
        error: 'No run_id returned from task creation',
      }
    }

    logger.info(`Parallel AI deep research task ${runId} created, fetching results...`)

    try {
      const resultResponse = await fetch(
        `https://api.parallel.ai/v1/tasks/runs/${String(runId).trim()}/result?timeout=${RESULT_TIMEOUT_SECONDS}`,
        {
          method: 'GET',
          headers: {
            'x-api-key': params.apiKey,
            'Content-Type': 'application/json',
          },
        }
      )

      if (!resultResponse.ok) {
        const errorText = await resultResponse.text()
        throw new Error(`Failed to get task result: ${resultResponse.status} - ${errorText}`)
      }

      const taskResult = await resultResponse.json()
      logger.info(`Parallel AI deep research task ${runId} completed`)

      const output = taskResult.output ?? {}
      const status = taskResult.run?.status ?? 'completed'

      return {
        success: true,
        output: {
          status,
          run_id: runId,
          message: 'Research completed successfully',
          content: output.content ?? {},
          basis: output.basis ?? [],
        },
      }
    } catch (error: unknown) {
      const errorMessage = getErrorMessage(error, 'Unknown error')
      logger.error('Error fetching research task result:', {
        message: errorMessage,
        runId,
      })

      return {
        ...result,
        success: false,
        error: `Error fetching research task result: ${errorMessage}`,
      }
    }
  },

  outputs: {
    status: {
      type: 'string',
      description: 'Task status (completed, failed, running)',
    },
    run_id: {
      type: 'string',
      description: 'Unique ID for this research task',
    },
    message: {
      type: 'string',
      description: 'Status message',
    },
    content: {
      type: 'json',
      description:
        'Research findings: a markdown report string for the text output format, or a structured object with query-specific keys for the auto format',
    },
    basis: {
      type: 'array',
      description: 'Citations and sources with reasoning and confidence levels',
      items: {
        type: 'object',
        properties: {
          field: { type: 'string', description: 'Output field dot-notation path' },
          reasoning: { type: 'string', description: 'Explanation for the result' },
          citations: {
            type: 'array',
            description: 'Array of sources',
            items: {
              type: 'object',
              properties: {
                url: { type: 'string', description: 'Source URL' },
                title: { type: 'string', description: 'Source title', optional: true },
                excerpts: {
                  type: 'array',
                  description: 'Relevant excerpts from the source',
                  items: { type: 'string' },
                  optional: true,
                },
              },
            },
          },
          confidence: {
            type: 'string',
            description: 'Confidence level (low, medium, high)',
            optional: true,
          },
        },
      },
    },
  },
}
