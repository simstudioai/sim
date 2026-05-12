import { db } from '@sim/db'
import { account, webhook } from '@sim/db/schema'
import { createLogger, runWithRequestContext } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { task } from '@trigger.dev/sdk'
import { eq } from 'drizzle-orm'
import type { AsyncExecutionCorrelation } from '@/lib/core/async-jobs/types'
import { createTimeoutAbortController, getTimeoutErrorMessage } from '@/lib/core/execution-limits'
import { IdempotencyService, webhookIdempotency } from '@/lib/core/idempotency'
import { preprocessExecution } from '@/lib/execution/preprocessing'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import {
  type WebhookAttachment,
  WebhookAttachmentProcessor,
} from '@/lib/webhooks/attachment-processor'
import { resolveWebhookRecordProviderConfig } from '@/lib/webhooks/env-resolver'
import { getProviderHandler } from '@/lib/webhooks/providers'
import {
  executeWorkflowCore,
  wasExecutionFinalizedByCore,
} from '@/lib/workflows/executor/execution-core'
import { handlePostExecutionPauseState } from '@/lib/workflows/executor/pause-persistence'
import { loadDeployedWorkflowState } from '@/lib/workflows/persistence/utils'
import { resolveOAuthAccountId } from '@/app/api/auth/oauth/utils'
import { getBlock } from '@/blocks'
import { ExecutionSnapshot } from '@/executor/execution/snapshot'
import type { ExecutionMetadata } from '@/executor/execution/types'
import type { ExecutionResult } from '@/executor/types'
import { hasExecutionResult } from '@/executor/utils/errors'
import { safeAssign } from '@/tools/safe-assign'
import { getTrigger, isTriggerValid } from '@/triggers'

const logger = createLogger('TriggerWebhookExecution')

type WebhookAttachmentInput = Omit<WebhookAttachment, 'data'> & { data: unknown }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSerializedBuffer(value: unknown): value is { type: 'Buffer'; data: number[] } {
  return isRecord(value) && value.type === 'Buffer' && Array.isArray(value.data)
}

function hasSupportedAttachmentData(value: unknown): boolean {
  return (
    Buffer.isBuffer(value) ||
    typeof value === 'string' ||
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value) ||
    Array.isArray(value) ||
    isSerializedBuffer(value)
  )
}

function toAttachmentBuffer(data: unknown, name: string): Buffer {
  if (Buffer.isBuffer(data)) {
    return data
  }

  if (isSerializedBuffer(data)) {
    return Buffer.from(data.data)
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data)
  }

  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  }

  if (Array.isArray(data)) {
    return Buffer.from(data)
  }

  if (typeof data === 'string') {
    const trimmed = data.trim()
    if (trimmed.startsWith('data:')) {
      const [, base64Data] = trimmed.split(',')
      return Buffer.from(base64Data ?? '', 'base64')
    }
    return Buffer.from(trimmed, 'base64')
  }

  throw new Error(`Attachment '${name}' has unsupported data format`)
}

function isWebhookAttachmentInput(value: unknown): value is WebhookAttachmentInput {
  if (!isRecord(value)) {
    return false
  }

  return (
    typeof value.name === 'string' &&
    typeof value.size === 'number' &&
    hasSupportedAttachmentData(value.data) &&
    (value.contentType === undefined || typeof value.contentType === 'string') &&
    (value.mimeType === undefined || typeof value.mimeType === 'string')
  )
}

function normalizeWebhookAttachment(value: unknown): WebhookAttachment | null {
  if (!isWebhookAttachmentInput(value)) {
    return null
  }

  return {
    name: value.name,
    data: toAttachmentBuffer(value.data, value.name),
    contentType: value.contentType,
    mimeType: value.mimeType,
    size: value.size,
  }
}

function normalizeWebhookAttachments(value: unknown): WebhookAttachment[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((attachment) => {
    const normalized = normalizeWebhookAttachment(attachment)
    return normalized ? [normalized] : []
  })
}

export function buildWebhookCorrelation(
  payload: WebhookExecutionPayload
): AsyncExecutionCorrelation {
  const executionId = payload.executionId || generateId()
  const requestId = payload.requestId || payload.correlation?.requestId || executionId.slice(0, 8)

  return {
    executionId,
    requestId,
    source: 'webhook',
    workflowId: payload.workflowId,
    webhookId: payload.webhookId,
    path: payload.path,
    provider: payload.provider,
    triggerType: payload.correlation?.triggerType || 'webhook',
  }
}

/**
 * Process trigger outputs based on their schema definitions.
 * Finds outputs marked as 'file' or 'file[]' and uploads them to execution storage.
 */
async function processTriggerFileOutputs(
  input: unknown,
  triggerOutputs: Record<string, unknown>,
  context: {
    workspaceId: string
    workflowId: string
    executionId: string
    requestId: string
    userId?: string
  },
  path = ''
): Promise<unknown> {
  if (!input || typeof input !== 'object') {
    return input
  }

  const processed = (Array.isArray(input) ? [] : {}) as Record<string, unknown>

  for (const [key, value] of Object.entries(input)) {
    const currentPath = path ? `${path}.${key}` : key
    const outputDef = triggerOutputs[key] as Record<string, unknown> | undefined

    if (outputDef?.type === 'file[]' && Array.isArray(value)) {
      try {
        processed[key] = await WebhookAttachmentProcessor.processAttachments(
          normalizeWebhookAttachments(value),
          context
        )
      } catch (error) {
        processed[key] = []
      }
    } else if (outputDef?.type === 'file' && value) {
      const attachment = normalizeWebhookAttachment(value)
      if (!attachment) {
        processed[key] = value
        continue
      }

      try {
        const [processedFile] = await WebhookAttachmentProcessor.processAttachments(
          [attachment],
          context
        )
        processed[key] = processedFile
      } catch (error) {
        logger.error(`[${context.requestId}] Error processing ${currentPath}:`, error)
        processed[key] = value
      }
    } else if (
      outputDef &&
      typeof outputDef === 'object' &&
      (outputDef.type === 'object' || outputDef.type === 'json') &&
      outputDef.properties
    ) {
      processed[key] = await processTriggerFileOutputs(
        value,
        outputDef.properties as Record<string, unknown>,
        context,
        currentPath
      )
    } else if (outputDef && typeof outputDef === 'object' && !outputDef.type) {
      processed[key] = await processTriggerFileOutputs(
        value,
        outputDef as Record<string, unknown>,
        context,
        currentPath
      )
    } else {
      processed[key] = value
    }
  }

  return processed
}

export type WebhookExecutionPayload = {
  webhookId: string
  workflowId: string
  userId: string
  executionId?: string
  requestId?: string
  correlation?: AsyncExecutionCorrelation
  provider: string
  body: unknown
  headers: Record<string, string>
  path: string
  blockId?: string
  workspaceId?: string
  credentialId?: string
}

export async function executeWebhookJob(payload: WebhookExecutionPayload) {
  const correlation = buildWebhookCorrelation(payload)
  const executionId = correlation.executionId
  const requestId = correlation.requestId

  return runWithRequestContext({ requestId }, async () => {
    logger.info(`[${requestId}] Starting webhook execution`, {
      webhookId: payload.webhookId,
      workflowId: payload.workflowId,
      provider: payload.provider,
      userId: payload.userId,
      executionId,
    })

    const idempotencyKey = IdempotencyService.createWebhookIdempotencyKey(
      payload.webhookId,
      payload.headers,
      payload.body,
      payload.provider
    )

    const runOperation = async () => {
      return await executeWebhookJobInternal(payload, correlation)
    }

    return await webhookIdempotency.executeWithIdempotency(
      payload.provider,
      idempotencyKey,
      runOperation
    )
  })
}

export async function resolveWebhookExecutionProviderConfig<
  T extends { id: string; providerConfig?: unknown },
>(
  webhookRecord: T,
  provider: string,
  userId: string,
  workspaceId?: string
): Promise<T & { providerConfig: Record<string, unknown> }> {
  try {
    return await resolveWebhookRecordProviderConfig(webhookRecord, userId, workspaceId)
  } catch (error) {
    const errorMessage = toError(error).message
    throw new Error(
      `Failed to resolve webhook provider config for ${provider} webhook ${webhookRecord.id}: ${errorMessage}`
    )
  }
}

async function resolveCredentialAccountUserId(credentialId: string): Promise<string | undefined> {
  const resolved = await resolveOAuthAccountId(credentialId)
  if (!resolved) {
    return undefined
  }
  const [credentialRecord] = await db
    .select({ userId: account.userId })
    .from(account)
    .where(eq(account.id, resolved.accountId))
    .limit(1)
  return credentialRecord?.userId
}

/**
 * Handle execution result status (timeout, pause, resume).
 * Shared between all provider paths to eliminate duplication.
 */
async function handleExecutionResult(
  executionResult: ExecutionResult,
  ctx: {
    loggingSession: LoggingSession
    timeoutController: ReturnType<typeof createTimeoutAbortController>
    requestId: string
    executionId: string
    workflowId: string
  }
) {
  if (
    executionResult.status === 'cancelled' &&
    ctx.timeoutController.isTimedOut() &&
    ctx.timeoutController.timeoutMs
  ) {
    const timeoutErrorMessage = getTimeoutErrorMessage(null, ctx.timeoutController.timeoutMs)
    logger.info(`[${ctx.requestId}] Webhook execution timed out`, {
      timeoutMs: ctx.timeoutController.timeoutMs,
    })
    await ctx.loggingSession.markAsFailed(timeoutErrorMessage)
  } else {
    await handlePostExecutionPauseState({
      result: executionResult,
      workflowId: ctx.workflowId,
      executionId: ctx.executionId,
      loggingSession: ctx.loggingSession,
    })
  }

  await ctx.loggingSession.waitForPostExecution()
}

async function executeWebhookJobInternal(
  payload: WebhookExecutionPayload,
  correlation: AsyncExecutionCorrelation
) {
  const { executionId, requestId } = correlation
  const loggingSession = new LoggingSession(
    payload.workflowId,
    executionId,
    payload.provider,
    requestId
  )

  const preprocessResult = await preprocessExecution({
    workflowId: payload.workflowId,
    userId: payload.userId,
    triggerType: 'webhook',
    executionId,
    requestId,
    triggerData: { correlation },
    checkRateLimit: false,
    checkDeployment: false,
    skipUsageLimits: true,
    workspaceId: payload.workspaceId,
    loggingSession,
  })

  if (!preprocessResult.success) {
    throw new Error(preprocessResult.error?.message || 'Preprocessing failed in background job')
  }

  const { workflowRecord, executionTimeout } = preprocessResult
  if (!workflowRecord) {
    throw new Error(`Workflow ${payload.workflowId} not found during preprocessing`)
  }

  const workspaceId = workflowRecord.workspaceId
  if (!workspaceId) {
    throw new Error(`Workflow ${payload.workflowId} has no associated workspace`)
  }

  const workflowVariables = (workflowRecord.variables as Record<string, unknown>) || {}
  const asyncTimeout = executionTimeout?.async ?? 120_000
  const timeoutController = createTimeoutAbortController(asyncTimeout)

  let deploymentVersionId: string | undefined

  try {
    const [workflowData, webhookRows, resolvedCredentialUserId] = await Promise.all([
      loadDeployedWorkflowState(payload.workflowId, workspaceId),
      db.select().from(webhook).where(eq(webhook.id, payload.webhookId)).limit(1),
      payload.credentialId
        ? resolveCredentialAccountUserId(payload.credentialId)
        : Promise.resolve(undefined),
    ])
    const credentialAccountUserId = resolvedCredentialUserId
    if (payload.credentialId && !credentialAccountUserId) {
      logger.warn(
        `[${requestId}] Failed to resolve credential account for credential ${payload.credentialId}`
      )
    }

    if (!workflowData) {
      throw new Error(
        'Workflow state not found. The workflow may not be deployed or the deployment data may be corrupted.'
      )
    }

    const { blocks, edges, loops, parallels } = workflowData
    deploymentVersionId =
      'deploymentVersionId' in workflowData
        ? (workflowData.deploymentVersionId as string)
        : undefined

    const handler = getProviderHandler(payload.provider)

    let input: Record<string, unknown> | null = null
    let skipMessage: string | undefined

    const webhookRecord = webhookRows[0]
    if (!webhookRecord) {
      throw new Error(`Webhook record not found: ${payload.webhookId}`)
    }

    const resolvedWebhookRecord = await resolveWebhookExecutionProviderConfig(
      webhookRecord,
      payload.provider,
      workflowRecord.userId,
      workspaceId
    )

    if (handler.formatInput) {
      const result = await handler.formatInput({
        webhook: resolvedWebhookRecord,
        workflow: { id: payload.workflowId, userId: payload.userId },
        body: payload.body,
        headers: payload.headers,
        requestId,
      })
      input = result.input as Record<string, unknown> | null
      skipMessage = result.skip?.message
    } else {
      input = payload.body as Record<string, unknown> | null
    }

    if (!input && handler.handleEmptyInput) {
      const skipResult = handler.handleEmptyInput(requestId)
      if (skipResult) {
        skipMessage = skipResult.message
      }
    }

    if (skipMessage) {
      await loggingSession.safeStart({
        userId: payload.userId,
        workspaceId,
        variables: {},
        triggerData: {
          isTest: false,
          correlation,
        },
        deploymentVersionId,
      })

      await loggingSession.safeComplete({
        endedAt: new Date().toISOString(),
        totalDurationMs: 0,
        finalOutput: { message: skipMessage },
        traceSpans: [],
      })

      return {
        success: true,
        workflowId: payload.workflowId,
        executionId,
        output: { message: skipMessage },
        executedAt: new Date().toISOString(),
      }
    }

    if (input && payload.blockId && blocks[payload.blockId]) {
      try {
        const triggerBlock = blocks[payload.blockId]
        const rawSelectedTriggerId = triggerBlock?.subBlocks?.selectedTriggerId?.value
        const rawTriggerId = triggerBlock?.subBlocks?.triggerId?.value

        let resolvedTriggerId = [rawSelectedTriggerId, rawTriggerId].find(
          (candidate): candidate is string =>
            typeof candidate === 'string' && isTriggerValid(candidate)
        )

        if (!resolvedTriggerId) {
          const blockConfig = getBlock(triggerBlock.type)
          if (blockConfig?.category === 'triggers' && isTriggerValid(triggerBlock.type)) {
            resolvedTriggerId = triggerBlock.type
          } else if (triggerBlock.triggerMode && blockConfig?.triggers?.enabled) {
            const available = blockConfig.triggers?.available?.[0]
            if (available && isTriggerValid(available)) {
              resolvedTriggerId = available
            }
          }
        }

        if (resolvedTriggerId) {
          const triggerConfig = getTrigger(resolvedTriggerId)

          if (triggerConfig.outputs) {
            const processedInput = await processTriggerFileOutputs(input, triggerConfig.outputs, {
              workspaceId,
              workflowId: payload.workflowId,
              executionId,
              requestId,
              userId: payload.userId,
            })
            safeAssign(input, processedInput as Record<string, unknown>)
          }
        }
      } catch (error) {
        logger.error(`[${requestId}] Error processing trigger file outputs:`, error)
      }
    }

    if (input && handler.processInputFiles && payload.blockId && blocks[payload.blockId]) {
      try {
        await handler.processInputFiles({
          input,
          blocks,
          blockId: payload.blockId,
          workspaceId,
          workflowId: payload.workflowId,
          executionId,
          requestId,
          userId: payload.userId,
        })
      } catch (error) {
        logger.error(`[${requestId}] Error processing provider-specific files:`, error)
      }
    }

    logger.info(`[${requestId}] Executing workflow for ${payload.provider} webhook`)

    const metadata: ExecutionMetadata = {
      requestId,
      executionId,
      workflowId: payload.workflowId,
      workspaceId,
      userId: payload.userId,
      sessionUserId: undefined,
      workflowUserId: workflowRecord.userId,
      triggerType: payload.provider || 'webhook',
      triggerBlockId: payload.blockId,
      useDraftState: false,
      startTime: new Date().toISOString(),
      isClientSession: false,
      credentialAccountUserId,
      correlation,
      workflowStateOverride: {
        blocks,
        edges,
        loops: loops || {},
        parallels: parallels || {},
        deploymentVersionId,
      },
    }

    const triggerInput = input || {}

    const snapshot = new ExecutionSnapshot(
      metadata,
      workflowRecord,
      triggerInput,
      workflowVariables,
      []
    )

    const executionResult = await executeWorkflowCore({
      snapshot,
      callbacks: {},
      loggingSession,
      includeFileBase64: false,
      base64MaxBytes: undefined,
      abortSignal: timeoutController.signal,
    })

    await handleExecutionResult(executionResult, {
      loggingSession,
      timeoutController,
      requestId,
      executionId,
      workflowId: payload.workflowId,
    })

    logger.info(`[${requestId}] Webhook execution completed`, {
      success: executionResult.success,
      workflowId: payload.workflowId,
      provider: payload.provider,
    })

    return {
      success: executionResult.success,
      workflowId: payload.workflowId,
      executionId,
      output: executionResult.output,
      executedAt: new Date().toISOString(),
      provider: payload.provider,
    }
  } catch (error: unknown) {
    const errorMessage = toError(error).message
    const errorStack = error instanceof Error ? error.stack : undefined

    logger.error(`[${requestId}] Webhook execution failed`, {
      error: errorMessage,
      stack: errorStack,
      workflowId: payload.workflowId,
      provider: payload.provider,
    })

    if (wasExecutionFinalizedByCore(error, executionId)) {
      throw error
    }

    try {
      await loggingSession.safeStart({
        userId: payload.userId,
        workspaceId,
        variables: {},
        triggerData: {
          isTest: false,
          correlation,
        },
        deploymentVersionId,
      })

      const executionResult = hasExecutionResult(error)
        ? error.executionResult
        : {
            success: false,
            output: {},
            logs: [],
          }
      const { traceSpans } = buildTraceSpans(executionResult)

      await loggingSession.safeCompleteWithError({
        endedAt: new Date().toISOString(),
        totalDurationMs: 0,
        error: {
          message: errorMessage || 'Webhook execution failed',
          stackTrace: errorStack,
        },
        traceSpans,
      })
    } catch (loggingError) {
      logger.error(`[${requestId}] Failed to complete logging session`, loggingError)
    }

    throw error
  } finally {
    timeoutController.cleanup()
  }
}

export const webhookExecution = task({
  id: 'webhook-execution',
  machine: 'medium-1x',
  retry: {
    maxAttempts: 1,
  },
  run: async (payload: WebhookExecutionPayload) => executeWebhookJob(payload),
})
