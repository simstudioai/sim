import type { Principal } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { z } from 'zod'
import { prepareBenchmarkPlan } from '@/lib/benchmarks/application/prepare-plan'
import { getBenchmarkMothershipUrl } from '@/lib/benchmarks/config'
import type { BenchmarkCase } from '@/lib/benchmarks/types'
import {
  resolveBillingAttribution,
  resolveOrganizationBillingAttribution,
} from '@/lib/billing/core/billing-attribution'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { prepareCopilotEnvironmentContext } from '@/lib/mothership/environment-context'
import type {
  BenchmarkExecution,
  ChatRequest,
  ExecuteMessage,
  ExecuteRequest,
} from '@/lib/mothership/generated/protocol'
import { PROTOCOL_VERSION } from '@/lib/mothership/generated/protocol'
import { runHeadlessCopilotLifecycle } from '@/lib/mothership/request/lifecycle/headless'
import { requestExplicitStreamAbort } from '@/lib/mothership/request/session/explicit-abort'
import type { OrchestratorResult } from '@/lib/mothership/request/types'

const logger = createLogger('BenchmarkWorker')

function requireCompletedText(result: OrchestratorResult): string {
  if (!result.success || result.cancelled) {
    throw new OrchestrationError(
      'validation',
      result.cancelled
        ? 'Benchmark step was cancelled'
        : 'Mothership could not complete this benchmark step. Check the worker logs and retry.'
    )
  }
  if (!result.content.trim()) {
    throw new OrchestrationError('validation', 'Mothership returned an empty benchmark result')
  }
  return result.content
}

async function stopIncompleteRun(
  result: OrchestratorResult | undefined,
  messageId: string,
  userId: string
): Promise<void> {
  if (result?.success) return
  try {
    await requestExplicitStreamAbort({
      streamId: messageId,
      userId,
      mothershipBaseURL: getBenchmarkMothershipUrl(),
    })
  } catch {
    logger.warn('Benchmark worker cancellation could not be confirmed', { messageId })
  }
}

/** Each invocation uses a fresh conversation; optional profiles expose only the stage's permitted reads. */
export async function executeBenchmarkJson<S extends z.ZodType>(input: {
  benchmark: BenchmarkCase
  messages: ExecuteMessage[]
  schema: S
  signal: AbortSignal
  profile?: BenchmarkExecution
  chatId?: string
}): Promise<z.output<S>> {
  getBenchmarkMothershipUrl()
  const executionUserId = input.benchmark.runAsUserId ?? input.benchmark.userId
  const messageId = generateId()
  const payload: ExecuteRequest = {
    protocolVersion: PROTOCOL_VERSION,
    messageId,
    chatId: input.chatId ?? generateId(),
    benchmark: input.profile,
    userId: executionUserId,
    workspaceId: input.benchmark.sourceWorkspaceId,
    messages: input.messages,
    useConversationHistory: false,
    responseFormat: z.toJSONSchema(input.schema),
  }
  const billingAttribution = await resolveBillingAttribution({
    actorUserId: executionUserId,
    workspaceId: input.benchmark.sourceWorkspaceId,
  })
  const environmentContext = await prepareCopilotEnvironmentContext(
    executionUserId,
    input.benchmark.sourceWorkspaceId,
    { includeSecrets: false }
  )
  let result: OrchestratorResult | undefined
  try {
    result = await runHeadlessCopilotLifecycle(
      { ...payload },
      {
        benchmark: input.profile?.stage ?? 'tool-free',
        goRoute: '/api/mothership/execute',
        userId: executionUserId,
        workspaceId: input.benchmark.sourceWorkspaceId,
        chatId: payload.chatId,
        billingAttribution,
        environmentContext,
        ...(input.profile?.stage === 'distill' ? { userPermission: 'read' as const } : {}),
        abortSignal: input.signal,
        clientToolPickupExpected: false,
      }
    )
    const text = requireCompletedText(result).trim()
    if (!input.profile && result.toolCalls.length)
      throw new OrchestrationError(
        'validation',
        'The isolated benchmark reader attempted a tool call'
      )
    const json = text.startsWith('```')
      ? text.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```$/, '')
      : text
    try {
      return input.schema.parse(JSON.parse(json))
    } catch {
      throw new OrchestrationError(
        'validation',
        'Mothership returned an invalid structured result. Retry this step.'
      )
    }
  } finally {
    await stopIncompleteRun(result, messageId, executionUserId)
  }
}

/** The planner receives only the brief; the source workspace and hidden reference never enter its request. */
export async function executeBenchmarkPlan(input: {
  principal: Principal
  benchmark: BenchmarkCase
  signal: AbortSignal
}): Promise<{ generatedSpec: string; plannerChatId: string }> {
  getBenchmarkMothershipUrl()
  const target = await prepareBenchmarkPlan.execute({
    principal: input.principal,
    input: { organizationId: input.benchmark.organizationId, benchmarkId: input.benchmark.id },
  })
  const executionUserId = target.userId
  const messageId = generateId()
  const payload: ChatRequest = {
    protocolVersion: PROTOCOL_VERSION,
    benchmark: true,
    messageId,
    chatId: target.chatId,
    userId: executionUserId,
    organizationId: input.benchmark.organizationId,
    mode: 'plan',
    context: [],
    message: input.benchmark.artifacts.taskBrief,
  }
  const billingAttribution = await resolveOrganizationBillingAttribution({
    actorUserId: executionUserId,
    organizationId: input.benchmark.organizationId,
  })
  let result: OrchestratorResult | undefined
  try {
    result = await runHeadlessCopilotLifecycle(payload, {
      benchmark: 'plan',
      goRoute: '/api/mothership',
      userId: executionUserId,
      organizationId: input.benchmark.organizationId,
      chatId: target.chatId,
      billingAttribution,
      abortSignal: input.signal,
      clientToolPickupExpected: false,
    })
    return {
      generatedSpec: requireCompletedText(result),
      plannerChatId: target.chatId,
    }
  } finally {
    await stopIncompleteRun(result, messageId, executionUserId)
  }
}
