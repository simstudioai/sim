import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { DEFAULT_EXECUTION_TIMEOUT_MS } from '@/lib/core/execution-limits'
import type { ExaAgentParams, ExaAgentResponse } from '@/tools/exa/types'
import { parseJsonSchema, requireCostTotal } from '@/tools/exa/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('ExaAgentTool')

const POLL_INTERVAL_MS = 3000
const MAX_POLL_TIME_MS = DEFAULT_EXECUTION_TIMEOUT_MS

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled'])

export const agentTool: ToolConfig<ExaAgentParams, ExaAgentResponse> = {
  id: 'exa_agent',
  name: 'Exa Agent',
  description:
    'Run a deep research task with Exa Agent. Handles multi-step list building, enrichment, and research, returning a written answer with field-level citations and optional structured output.',
  version: '1.0.0',

  params: {
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The research question or instructions for the agent',
    },
    effort: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Cost and depth tradeoff: minimal, low, medium, high, xhigh, or auto (default: auto)',
    },
    outputSchema: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON Schema describing the structured result to return. Returned in the structured output.',
    },
    systemPrompt: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Additional guidance for how the agent should behave or format its answer',
    },
    previousRunId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of a completed agent run to continue from, for follow-up questions',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Exa AI API Key',
    },
  },
  hosting: {
    envKeyPrefix: 'EXA_API_KEY',
    apiKeyParam: 'apiKey',
    byokProviderId: 'exa',
    pricing: {
      type: 'custom',
      getCost: (_params, output) => {
        const cost = requireCostTotal(output, 'agent')
        return { cost, metadata: { costDollars: output.__costDollars } }
      },
    },
    rateLimit: {
      mode: 'per_request',
      requestsPerMinute: 5,
    },
  },

  request: {
    url: 'https://api.exa.ai/agent/runs',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      'x-api-key': params.apiKey,
    }),
    body: (params) => {
      const body: Record<string, any> = {
        query: params.query,
      }

      if (params.effort) body.effort = params.effort
      if (params.systemPrompt) body.systemPrompt = params.systemPrompt
      if (params.previousRunId) body.previousRunId = params.previousRunId

      const outputSchema = parseJsonSchema(params.outputSchema, 'outputSchema')
      if (outputSchema) body.outputSchema = outputSchema

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        runId: data.id,
        status: data.status,
        stopReason: data.stopReason,
        text: data.output?.text ?? '',
        structured: data.output?.structured ?? undefined,
        grounding: data.output?.grounding,
        __costDollars: data.costDollars,
      },
    }
  },

  /**
   * Agent runs are asynchronous: the create call returns immediately with a
   * `queued` or `running` status, so poll the run until it reaches a terminal
   * status before handing results back to the workflow.
   */
  postProcess: async (result, params) => {
    if (!result.success) return result

    const runId = result.output.runId
    if (!runId) {
      return { ...result, success: false, error: 'Exa agent run did not return a run ID' }
    }

    if (TERMINAL_STATUSES.has(result.output.status ?? '')) {
      return finalize(result)
    }

    logger.info(`Exa agent run ${runId} created, polling for completion`)

    let elapsedTime = 0

    while (elapsedTime < MAX_POLL_TIME_MS) {
      await sleep(POLL_INTERVAL_MS)
      elapsedTime += POLL_INTERVAL_MS

      try {
        const statusResponse = await fetch(`https://api.exa.ai/agent/runs/${runId}`, {
          method: 'GET',
          headers: {
            'x-api-key': params.apiKey,
            'Content-Type': 'application/json',
          },
        })

        if (!statusResponse.ok) {
          throw new Error(`Failed to get agent run status: ${statusResponse.statusText}`)
        }

        const runData = await statusResponse.json()

        if (!TERMINAL_STATUSES.has(runData.status)) continue

        result.output = {
          runId,
          status: runData.status,
          stopReason: runData.stopReason,
          text: runData.output?.text ?? '',
          structured: runData.output?.structured ?? undefined,
          grounding: runData.output?.grounding,
          __costDollars: runData.costDollars,
        }

        if (runData.status !== 'completed') {
          return {
            ...result,
            success: false,
            error: `Exa agent run ${runData.status}${runData.stopReason ? `: ${runData.stopReason}` : ''}`,
          }
        }

        return finalize(result)
      } catch (error) {
        logger.error('Error polling Exa agent run status', {
          message: getErrorMessage(error, 'Unknown error'),
          runId,
        })

        return {
          ...result,
          success: false,
          error: `Error polling Exa agent run status: ${getErrorMessage(error, 'Unknown error')}`,
        }
      }
    }

    logger.warn(
      `Exa agent run ${runId} did not complete within the maximum polling time (${MAX_POLL_TIME_MS / 1000}s)`
    )
    return {
      ...result,
      success: false,
      error: `Exa agent run did not complete within the maximum polling time (${MAX_POLL_TIME_MS / 1000}s)`,
    }
  },

  outputs: {
    runId: {
      type: 'string',
      description: 'Identifier of the agent run, reusable as previousRunId',
    },
    status: { type: 'string', description: 'Final status of the agent run' },
    stopReason: {
      type: 'string',
      description: 'Why the agent stopped, such as schema_satisfied',
      nullable: true,
    },
    text: { type: 'string', description: 'The written answer produced by the agent' },
    structured: {
      type: 'json',
      description: 'Structured result matching outputSchema, when one was supplied',
      optional: true,
    },
    grounding: {
      type: 'json',
      description: 'Field-level citations backing the agent output',
      optional: true,
    },
  },
}

/**
 * A run that satisfies its schema can finish with an empty `text` body, so fall
 * back to the structured payload rather than returning a blank answer.
 */
function finalize(result: ExaAgentResponse): ExaAgentResponse {
  if (!result.output.text && result.output.structured !== undefined) {
    result.output.text = JSON.stringify(result.output.structured, null, 2)
  }
  return result
}
