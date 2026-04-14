import { createLogger } from '@sim/logger'
import { SIM_AGENT_API_URL } from '@/lib/copilot/constants'
import {
  MothershipStreamV1EventType,
  MothershipStreamV1SpanPayloadKind,
} from '@/lib/copilot/generated/mothership-stream-v1'
import { createStreamingContext } from '@/lib/copilot/request/context/request-context'
import { buildToolCallSummaries } from '@/lib/copilot/request/context/result'
import { runStreamLoop } from '@/lib/copilot/request/go/stream'
import type {
  ExecutionContext,
  OrchestratorOptions,
  StreamEvent,
  StreamingContext,
  ToolCallSummary,
} from '@/lib/copilot/request/types'
import { prepareExecutionContext } from '@/lib/copilot/tools/handlers/context'
import { env } from '@/lib/core/config/env'
import { generateId } from '@/lib/core/utils/uuid'
import { getEffectiveDecryptedEnv } from '@/lib/environment/utils'

const logger = createLogger('CopilotSubagentOrchestrator')

export interface SubagentOrchestratorOptions extends Omit<OrchestratorOptions, 'onComplete'> {
  userId: string
  workflowId?: string
  workspaceId?: string
  userPermission?: string
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
  const { userId, workflowId, workspaceId, userPermission } = options
  const execContext = await buildExecutionContext(userId, workflowId, workspaceId)

  const msgId = requestPayload?.messageId
  const context = createStreamingContext({
    messageId: typeof msgId === 'string' ? msgId : generateId(),
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
        body: JSON.stringify({
          ...requestPayload,
          userId,
          stream: true,
          ...(userPermission ? { userPermission } : {}),
        }),
      },
      context,
      execContext,
      {
        ...options,
        interactive: false,
        onBeforeDispatch: (event: StreamEvent, ctx: StreamingContext) => {
          if (
            event.type === MothershipStreamV1EventType.span &&
            (event.payload.kind === MothershipStreamV1SpanPayloadKind.structured_result ||
              event.payload.kind === MothershipStreamV1SpanPayloadKind.subagent_result)
          ) {
            structuredResult = normalizeStructuredResult(event.payload.data)
            ctx.streamComplete = true
            return true
          }

          if (event.scope?.agentId === agentId && !ctx.subAgentParentToolCallId) {
            return false
          }

          return false
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
