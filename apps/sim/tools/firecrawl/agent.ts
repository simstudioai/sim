import { createLogger } from '@sim/logger'
import { DEFAULT_EXECUTION_TIMEOUT_MS } from '@/lib/core/execution-limits'
import type { AgentParams, AgentResponse } from '@/tools/firecrawl/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('FirecrawlAgentTool')

const POLL_INTERVAL_MS = 5000
const MAX_POLL_TIME_MS = DEFAULT_EXECUTION_TIMEOUT_MS

export const agentTool: ToolConfig<AgentParams, AgentResponse> = {
  id: 'firecrawl_agent',
  name: 'Firecrawl Agent',
  description:
    'Autonomous web data extraction agent. Searches and gathers information based on natural language prompts without requiring specific URLs.',
  version: '1.0.0',

  params: {
    prompt: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Natural language description of the data to extract (max 10,000 characters)',
    },
    urls: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Optional array of URLs to focus the agent on (e.g., ["https://example.com", "https://docs.example.com"])',
    },
    schema: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON Schema defining the structure of data to extract',
    },
    maxCredits: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Maximum credits to spend on this agent task',
    },
    strictConstrainToURLs: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'If true, agent will only visit URLs provided in the urls array',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Firecrawl API key',
    },
  },

  request: {
    method: 'POST',
    url: 'https://api.firecrawl.dev/v2/agent',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => {
      const body: Record<string, any> = {
        prompt: params.prompt,
      }

      if (params.urls) {
        if (Array.isArray(params.urls)) {
          body.urls = params.urls
        } else if (typeof params.urls === 'string') {
          try {
            const parsed = JSON.parse(params.urls)
            body.urls = Array.isArray(parsed) ? parsed : [parsed]
          } catch {
            body.urls = [params.urls]
          }
        }
      }
      if (params.schema) body.schema = params.schema
      if (params.maxCredits) body.maxCredits = Number(params.maxCredits)
      if (typeof params.strictConstrainToURLs === 'boolean')
        body.strictConstrainToURLs = params.strictConstrainToURLs

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        jobId: data.id,
        success: false,
        status: 'processing',
        data: {},
      },
    }
  },

  postProcess: async (result, params) => {
    if (!result.success) {
      return result
    }

    const jobId = result.output.jobId
    logger.info(`Firecrawl agent job ${jobId} created, polling for completion...`)

    let elapsedTime = 0

    while (elapsedTime < MAX_POLL_TIME_MS) {
      try {
        const statusResponse = await fetch(`https://api.firecrawl.dev/v2/agent/${jobId}`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${params.apiKey}`,
            'Content-Type': 'application/json',
          },
        })

        if (!statusResponse.ok) {
          throw new Error(`Failed to get agent status: ${statusResponse.statusText}`)
        }

        const agentData = await statusResponse.json()
        logger.info(`Firecrawl agent job ${jobId} status: ${agentData.status}`)

        if (agentData.status === 'completed') {
          result.output = {
            jobId,
            success: true,
            status: 'completed',
            data: agentData.data || {},
            creditsUsed: agentData.creditsUsed,
            expiresAt: agentData.expiresAt,
            sources: agentData.sources,
          }
          return result
        }

        if (agentData.status === 'failed') {
          return {
            ...result,
            success: false,
            error: `Agent job failed: ${agentData.error || 'Unknown error'}`,
          }
        }

        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
        elapsedTime += POLL_INTERVAL_MS
      } catch (error: any) {
        logger.error('Error polling for agent job status:', {
          message: error.message || 'Unknown error',
          jobId,
        })

        return {
          ...result,
          success: false,
          error: `Error polling for agent job status: ${error.message || 'Unknown error'}`,
        }
      }
    }

    logger.warn(
      `Agent job ${jobId} did not complete within the maximum polling time (${MAX_POLL_TIME_MS / 1000}s)`
    )
    return {
      ...result,
      success: false,
      error: `Agent job did not complete within the maximum polling time (${MAX_POLL_TIME_MS / 1000}s)`,
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the agent operation was successful',
    },
    status: {
      type: 'string',
      description: 'Current status of the agent job (processing, completed, failed)',
    },
    data: {
      type: 'object',
      description: 'Extracted data from the agent',
    },
    creditsUsed: {
      type: 'number',
      description: 'Number of credits consumed by this agent task',
    },
    expiresAt: {
      type: 'string',
      description: 'Timestamp when the results expire (24 hours)',
    },
    sources: {
      type: 'object',
      description: 'Array of source URLs used by the agent',
    },
  },
}
