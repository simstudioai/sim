import { createLogger } from '@sim/logger'
import { SIM_AGENT_API_URL } from '@/lib/copilot/constants'
import { prepareExecutionContext } from '@/lib/copilot/orchestrator/tool-executor'
import type {
  ExecutionContext,
  OrchestratorOptions,
  SSEEvent,
  StreamingContext,
  ToolCallSummary,
} from '@/lib/copilot/orchestrator/types'
import { env } from '@/lib/core/config/env'
import { getEffectiveDecryptedEnv } from '@/lib/environment/utils'
import { buildToolCallSummaries, createStreamingContext, runStreamLoop } from './stream-core'

const logger = createLogger('CopilotSubagentOrchestrator')

export interface SubagentOrchestratorOptions extends Omit<OrchestratorOptions, 'onComplete'> {
  userId: string
  workflowId?: string
  workspaceId?: string
  onComplete?: (result: SubagentOrchestratorResult) => void | Promise<void>
}

export interface SubagentOrchestratorResult {
  success: boolean
  content: string
  toolCalls: ToolCallSummary[]
  structuredResult?: {
    type?: string
    summary?: string
    data?: unknown
    success?: boolean
  }
  error?: string
  errors?: string[]
}

export async function orchestrateSubagentStream(
  agentId: string,
  requestPayload: Record<string, unknown>,
  options: SubagentOrchestratorOptions
): Promise<SubagentOrchestratorResult> {
  const { userId, workflowId, workspaceId } = options
  const execContext = await buildExecutionContext(userId, workflowId, workspaceId)

  const msgId = requestPayload?.messageId
  const context = createStreamingContext({
    messageId: typeof msgId === 'string' ? msgId : crypto.randomUUID(),
  })

  let structuredResult: SubagentOrchestratorResult['structuredResult']

  try {
    await runStreamLoop(
      `${SIM_AGENT_API_URL}/api/subagent/${agentId}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(env.COPILOT_API_KEY ? { 'x-api-key': env.COPILOT_API_KEY } : {}),
        },
        body: JSON.stringify({ ...requestPayload, userId, stream: true }),
      },
      context,
      execContext,
      {
        ...options,
        onBeforeDispatch: (event: SSEEvent, ctx: StreamingContext) => {
          // Handle structured_result / subagent_result - subagent-specific.
          if (event.type === 'structured_result' || event.type === 'subagent_result') {
            structuredResult = normalizeStructuredResult(event.data)
            ctx.streamComplete = true
            return true // skip default dispatch
          }

          // For direct subagent calls, events may have the subagent field set
          // but no copilot.subagent.started because this IS the top-level agent.
          // Skip subagent routing for events where the subagent field matches
          // the current agentId - these are top-level events.
          if (event.subagent === agentId && !ctx.subAgentParentToolCallId) {
            return false // let default dispatch handle it
          }

          return false // let default dispatch handle it
        },
      }
    )

    const result: SubagentOrchestratorResult = {
      success: context.errors.length === 0 && !context.wasAborted,
      content: context.accumulatedContent,
      toolCalls: buildToolCallSummaries(context),
      structuredResult,
      errors: context.errors.length ? context.errors : undefined,
    }
    await options.onComplete?.(result)
    return result
  } catch (error) {
    const err = error instanceof Error ? error : new Error('Subagent orchestration failed')
    logger.error('Subagent orchestration failed', { error: err.message, agentId })
    await options.onError?.(err)
    return {
      success: false,
      content: context.accumulatedContent,
      toolCalls: [],
      error: err.message,
    }
  }
}

function normalizeStructuredResult(data: unknown): SubagentOrchestratorResult['structuredResult'] {
  if (!data || typeof data !== 'object') return undefined
  const d = data as Record<string, unknown>
  return {
    type: (d.result_type || d.type) as string | undefined,
    summary: d.summary as string | undefined,
    data: d.data ?? d,
    success: d.success as boolean | undefined,
  }
}

async function buildExecutionContext(
  userId: string,
  workflowId?: string,
  workspaceId?: string
): Promise<ExecutionContext> {
  if (workflowId) {
    return prepareExecutionContext(userId, workflowId)
  }
  const decryptedEnvVars = await getEffectiveDecryptedEnv(userId, workspaceId)
  return {
    userId,
    workflowId: workflowId || '',
    workspaceId,
    decryptedEnvVars,
  }
}
