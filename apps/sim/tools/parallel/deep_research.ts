import { createLogger } from '@sim/logger'
import { PlatformEvents } from '@/lib/core/telemetry'
import type { ParallelDeepResearchParams } from '@/tools/parallel/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

const logger = createLogger('ParallelDeepResearchTool')

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
        // Parallel Task API: cost varies by processor
        // https://docs.parallel.ai/resources/pricing
        const processorCosts: Record<string, number> = {
          lite: 0.005,
          base: 0.01,
          core: 0.025,
          core2x: 0.05,
          pro: 0.1,
          ultra: 0.3,
          ultra2x: 0.6,
          ultra4x: 1.2,
          ultra8x: 2.4,
        }
        const processor = (params.processor as string) || 'base'
        const DEFAULT_PROCESSOR_COST = processorCosts.base
        const knownCost = processorCosts[processor]
        if (knownCost == null) {
          logger.warn(
            `Unknown Parallel processor "${processor}", using default processor cost $${DEFAULT_PROCESSOR_COST}`
          )
          PlatformEvents.hostedKeyUnknownModelCost({
            toolId: 'parallel_deep_research',
            modelName: processor,
            defaultCost: DEFAULT_PROCESSOR_COST,
          })
        }
        const cost = knownCost ?? DEFAULT_PROCESSOR_COST
        return { cost, metadata: { processor, defaultProcessorCost: DEFAULT_PROCESSOR_COST } }
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
    processor: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Processing tier: pro, ultra, pro-fast, ultra-fast (default: pro)',
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
    url: 'https://api.parallel.ai/v1/tasks/runs',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      'x-api-key': params.apiKey,
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        input: params.input,
        processor: params.processor || 'pro',
        task_spec: {
          output_schema: 'auto',
        },
      }

      if (params.include_domains || params.exclude_domains) {
        const sourcePolicy: Record<string, string[]> = {}

        if (params.include_domains) {
          sourcePolicy.include_domains = params.include_domains
            .split(',')
            .map((d) => d.trim())
            .filter((d) => d.length > 0)
        }

        if (params.exclude_domains) {
          sourcePolicy.exclude_domains = params.exclude_domains
            .split(',')
            .map((d) => d.trim())
            .filter((d) => d.length > 0)
        }

        if (Object.keys(sourcePolicy).length > 0) {
          body.source_policy = sourcePolicy
        }
      }

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
        `https://api.parallel.ai/v1/tasks/runs/${String(runId).trim()}/result`,
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
      const status = taskResult.status ?? 'completed'

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
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
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
      type: 'object',
      description: 'Research results (structured based on output_schema)',
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
                title: { type: 'string', description: 'Source title' },
                excerpts: { type: 'array', description: 'Relevant excerpts from the source' },
              },
            },
          },
          confidence: { type: 'string', description: 'Confidence level (high, medium)' },
        },
      },
    },
  },
}
