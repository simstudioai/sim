import { createLogger } from '@/lib/logs/console/logger'
import type { ExaResearchParams, ExaResearchResponse } from '@/tools/exa/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('ExaResearchTool')

const POLL_INTERVAL_MS = 5000 // 5 seconds between polls
const MAX_POLL_TIME_MS = 300000 // 5 minutes maximum polling time

export const researchTool: ToolConfig<ExaResearchParams, ExaResearchResponse> = {
  id: 'exa_research',
  name: 'Exa Research',
  description:
    'Perform comprehensive research using AI to generate detailed reports with citations',
  version: '1.0.0',
  params: {
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Research query or topic',
    },
    model: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Research model: exa-research-fast, exa-research (default), or exa-research-pro',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Exa AI API Key',
    },
  },

  request: {
    url: 'https://api.exa.ai/research/v1',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      'x-api-key': params.apiKey,
    }),
    body: (params) => {
      const body: any = {
        instructions: params.query,
      }

      // Add model if specified, otherwise use default
      if (params.model) {
        body.model = params.model
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        taskId: data.researchId,
        research: [],
      },
    }
  },
  postProcess: async (result, params) => {
    if (!result.success) {
      return result
    }

    const taskId = result.output.taskId
    logger.info(`Exa research task ${taskId} created, polling for completion...`)

    let elapsedTime = 0

    while (elapsedTime < MAX_POLL_TIME_MS) {
      try {
        const statusResponse = await fetch(`https://api.exa.ai/research/v1/${taskId}`, {
          method: 'GET',
          headers: {
            'x-api-key': params.apiKey,
            'Content-Type': 'application/json',
          },
        })

        if (!statusResponse.ok) {
          throw new Error(`Failed to get task status: ${statusResponse.statusText}`)
        }

        const taskData = await statusResponse.json()
        logger.info(`Exa research task ${taskId} status: ${taskData.status}`)

        if (taskData.status === 'completed') {
          // The completed response contains output.content (text) and output.parsed (structured data)
          const content =
            taskData.output?.content || taskData.output?.parsed || 'Research completed successfully'

          result.output = {
            research: [
              {
                title: 'Research Complete',
                url: '',
                summary: typeof content === 'string' ? content : JSON.stringify(content, null, 2),
                text: typeof content === 'string' ? content : JSON.stringify(content, null, 2),
                publishedDate: undefined,
                author: undefined,
                score: 1.0,
              },
            ],
          }
          return result
        }

        if (taskData.status === 'failed' || taskData.status === 'canceled') {
          return {
            ...result,
            success: false,
            error: `Research task ${taskData.status}: ${taskData.error || 'Unknown error'}`,
          }
        }

        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
        elapsedTime += POLL_INTERVAL_MS
      } catch (error: any) {
        logger.error('Error polling for research task status:', {
          message: error.message || 'Unknown error',
          taskId,
        })

        return {
          ...result,
          success: false,
          error: `Error polling for research task status: ${error.message || 'Unknown error'}`,
        }
      }
    }

    logger.warn(
      `Research task ${taskId} did not complete within the maximum polling time (${MAX_POLL_TIME_MS / 1000}s)`
    )
    return {
      ...result,
      success: false,
      error: `Research task did not complete within the maximum polling time (${MAX_POLL_TIME_MS / 1000}s)`,
    }
  },

  outputs: {
    research: {
      type: 'array',
      description: 'Comprehensive research findings with citations and summaries',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          url: { type: 'string' },
          summary: { type: 'string' },
          text: { type: 'string' },
          publishedDate: { type: 'string' },
          author: { type: 'string' },
          score: { type: 'number' },
        },
      },
    },
  },
}
