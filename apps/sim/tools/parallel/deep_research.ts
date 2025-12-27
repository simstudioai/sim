import { createLogger } from '@sim/logger'
import type { ParallelDeepResearchParams } from '@/tools/parallel/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

const logger = createLogger('ParallelDeepResearchTool')

export const deepResearchTool: ToolConfig<ParallelDeepResearchParams, ToolResponse> = {
  id: 'parallel_deep_research',
  name: 'Parallel AI Deep Research',
  description:
    'Conduct comprehensive deep research across the web using Parallel AI. Synthesizes information from multiple sources with citations. Can take up to 15 minutes to complete.',
  version: '1.0.0',

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
      description:
        'Compute level: base, lite, pro, ultra, ultra2x, ultra4x, ultra8x (default: base)',
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
        processor: params.processor || 'base',
      }

      const taskSpec: Record<string, unknown> = {}

      taskSpec.output_schema = 'auto'

      body.task_spec = taskSpec

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
    const data = await response.json()

    return {
      success: true,
      output: {
        run_id: data.run_id,
        status: data.status,
        message: `Research task ${data.status}, waiting for completion...`,
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
      const resultResponse = await fetch(`https://api.parallel.ai/v1/tasks/runs/${runId}/result`, {
        method: 'GET',
        headers: {
          'x-api-key': params.apiKey,
          'Content-Type': 'application/json',
        },
      })

      if (!resultResponse.ok) {
        const errorText = await resultResponse.text()
        throw new Error(`Failed to get task result: ${resultResponse.status} - ${errorText}`)
      }

      const taskResult = await resultResponse.json()
      logger.info(`Parallel AI deep research task ${runId} completed`)

      const output = taskResult.output || {}
      const run = taskResult.run || {}

      return {
        success: true,
        output: {
          status: run.status || 'completed',
          run_id: runId,
          message: 'Research completed successfully',
          content: output.content || {},
          basis: output.basis || [],
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
      description: 'Task status (completed, failed)',
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
          field: { type: 'string', description: 'Output field name' },
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
          confidence: { type: 'string', description: 'Confidence level indicator' },
        },
      },
    },
  },
}
