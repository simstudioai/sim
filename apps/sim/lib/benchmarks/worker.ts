import type { Principal } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { z } from 'zod'
import { getBenchmarkMothershipUrl } from '@/lib/benchmarks/config'
import { BENCHMARK_SPEC_MAX_LENGTH, type BenchmarkCase } from '@/lib/benchmarks/types'
import {
  resolveBillingAttribution,
  resolveOrganizationBillingAttribution,
} from '@/lib/billing/core/billing-attribution'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { createOrganizationChat } from '@/lib/mothership/chat/organization-chats'
import { prepareCopilotEnvironmentContext } from '@/lib/mothership/environment-context'
import type {
  ChatRequest,
  ExecuteMessage,
  ExecuteRequest,
} from '@/lib/mothership/generated/protocol'
import { PROTOCOL_VERSION } from '@/lib/mothership/generated/protocol'
import { runHeadlessCopilotLifecycle } from '@/lib/mothership/request/lifecycle/headless'
import { requestExplicitStreamAbort } from '@/lib/mothership/request/session/explicit-abort'
import type { OrchestratorResult } from '@/lib/mothership/request/types'

const logger = createLogger('BenchmarkWorker')

function requireCompletedText(result: OrchestratorResult, maxLength: number): string {
  if (!result.success || result.cancelled) {
    throw new OrchestrationError(
      'validation',
      result.cancelled
        ? 'Benchmark step was cancelled or timed out'
        : 'Mothership could not complete this benchmark step. Check the worker logs and retry.'
    )
  }
  if (!result.content.trim() || result.content.length > maxLength) {
    throw new OrchestrationError(
      'validation',
      'Mothership returned an empty or oversized benchmark result'
    )
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

/** Each invocation uses a fresh conversation and omits catalogs, tools, attachments, and history. */
export async function executeBenchmarkJson<S extends z.ZodType>(input: {
  benchmark: BenchmarkCase
  messages: ExecuteMessage[]
  schema: S
  signal: AbortSignal
}): Promise<z.output<S>> {
  getBenchmarkMothershipUrl()
  const messageId = generateId()
  const payload: ExecuteRequest = {
    protocolVersion: PROTOCOL_VERSION,
    maxOutputTokens: 16_384,
    messageId,
    chatId: generateId(),
    userId: input.benchmark.userId,
    workspaceId: input.benchmark.sourceWorkspaceId,
    messages: input.messages,
    useConversationHistory: false,
    responseFormat: z.toJSONSchema(input.schema),
  }
  const billingAttribution = await resolveBillingAttribution({
    actorUserId: input.benchmark.userId,
    workspaceId: input.benchmark.sourceWorkspaceId,
  })
  const environmentContext = await prepareCopilotEnvironmentContext(
    input.benchmark.userId,
    input.benchmark.sourceWorkspaceId,
    { includeSecrets: false }
  )
  let result: OrchestratorResult | undefined
  try {
    result = await runHeadlessCopilotLifecycle(
      { ...payload },
      {
        benchmark: 'tool-free',
        goRoute: '/api/mothership/execute',
        userId: input.benchmark.userId,
        workspaceId: input.benchmark.sourceWorkspaceId,
        billingAttribution,
        environmentContext,
        abortSignal: input.signal,
        timeout: 10 * 60 * 1000,
        clientToolPickupExpected: false,
      }
    )
    const text = requireCompletedText(result, 400_000).trim()
    if (result.toolCalls.length)
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
    await stopIncompleteRun(result, messageId, input.benchmark.userId)
  }
}

/** The planner receives only the brief; the source workspace and hidden reference never enter its request. */
export async function executeBenchmarkPlan(input: {
  principal: Principal
  benchmark: BenchmarkCase
  signal: AbortSignal
}): Promise<{ generatedSpec: string; plannerChatId: string }> {
  getBenchmarkMothershipUrl()
  const chat = await createOrganizationChat.execute({
    principal: input.principal,
    input: { organizationId: input.benchmark.organizationId, mode: 'plan' },
  })
  const messageId = generateId()
  const payload: ChatRequest = {
    protocolVersion: PROTOCOL_VERSION,
    benchmark: true,
    messageId,
    chatId: chat.id,
    userId: input.benchmark.userId,
    organizationId: input.benchmark.organizationId,
    mode: 'plan',
    context: [],
    message: input.benchmark.artifacts.taskBrief,
  }
  const billingAttribution = await resolveOrganizationBillingAttribution({
    actorUserId: input.benchmark.userId,
    organizationId: input.benchmark.organizationId,
  })
  let result: OrchestratorResult | undefined
  try {
    result = await runHeadlessCopilotLifecycle(payload, {
      benchmark: 'plan',
      goRoute: '/api/mothership',
      userId: input.benchmark.userId,
      organizationId: input.benchmark.organizationId,
      chatId: chat.id,
      billingAttribution,
      abortSignal: input.signal,
      timeout: 10 * 60 * 1000,
      clientToolPickupExpected: false,
    })
    return {
      generatedSpec: requireCompletedText(result, BENCHMARK_SPEC_MAX_LENGTH),
      plannerChatId: chat.id,
    }
  } finally {
    await stopIncompleteRun(result, messageId, input.benchmark.userId)
  }
}
