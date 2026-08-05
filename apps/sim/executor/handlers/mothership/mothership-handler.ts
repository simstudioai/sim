import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { isPlainRecord } from '@sim/utils/object'
import {
  BILLING_ATTRIBUTION_HEADER,
  serializeBillingAttributionHeader,
} from '@/lib/billing/core/billing-attribution'
import {
  collectModelVisibleSchemaContent,
  restoreModelVisibleSchemaValues,
} from '@/lib/copilot/model-visible-schema'
import { normalizeSecretMountPolicy } from '@/lib/copilot/secret-mount-policy'
import { env } from '@/lib/core/config/env'
import { isExecutionCancelled, isRedisCancellationEnabled } from '@/lib/execution/cancellation'
import { readUserFileContent } from '@/lib/execution/payloads/materialization.server'
import {
  inspectPrivateToolMetadataEnvelope,
  inspectPrivateToolMetadataResponseCapability,
  PRIVATE_TOOL_METADATA_REQUEST_HEADER,
  RESOLVED_SECRET_PROVENANCE_FIELD,
  RESOLVED_SECRET_PROVENANCE_METADATA_V1,
} from '@/lib/execution/private-tool-metadata'
import {
  areModelSafeWorkspaceFileKeys,
  MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE,
} from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import {
  createFileContentFromBase64,
  type MessageContent,
  processSingleFileToUserFile,
  type RawFileInput,
} from '@/lib/uploads/utils/file-utils'
import type { BlockOutput } from '@/blocks/types'
import { normalizeFileInput } from '@/blocks/utils'
import { BlockType } from '@/executor/constants'
import type {
  BlockHandler,
  ExecutionContext,
  NormalizedBlockOutput,
  StreamingExecution,
} from '@/executor/types'
import { buildAPIUrl, buildAuthHeaders, extractAPIErrorMessage } from '@/executor/utils/http'
import {
  isResolvedSecretModelContentUnchanged,
  projectResolvedSecretModelContent,
} from '@/executor/utils/resolved-secret-content-projection'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import type { SerializedBlock } from '@/serializer/types'

const logger = createLogger('MothershipBlockHandler')
const CANCELLATION_CHECK_INTERVAL_MS = 500
const MAX_MOTHERSHIP_ATTACHMENT_BYTES = 10 * 1024 * 1024
const MOTHERSHIP_EXECUTE_STREAM_HEADER = 'X-Mothership-Execute-Stream'
const MOTHERSHIP_EXECUTE_STREAM_VALUE = 'ndjson'

type MothershipFileAttachment = MessageContent & {
  filename?: string
}

interface MothershipMcpToolSelection {
  type: 'mcp'
  usageControl?: 'auto' | 'force'
  schema?: Record<string, unknown>
  params: {
    serverId: string
    toolName: string
    serverName?: string
  }
}

interface MothershipSkillContext {
  kind: 'skill'
  skillId: string
  label: string
}

type MothershipExecuteResult = {
  content?: string
  model?: string
  conversationId?: string
  tokens?: Record<string, unknown>
  toolCalls?: Array<Record<string, unknown>>
  cost?: unknown
} & Partial<Record<typeof RESOLVED_SECRET_PROVENANCE_FIELD, unknown>>

type MothershipExecuteStreamEvent =
  | { type: 'heartbeat'; timestamp?: string }
  | { type: 'chunk'; content?: string }
  | { type: 'final'; data: MothershipExecuteResult }
  | ({ type: 'error'; error?: string } & Partial<
      Record<typeof RESOLVED_SECRET_PROVENANCE_FIELD, unknown>
    >)

function projectMothershipPrompt(
  prompt: string,
  registry: ResolvedSecretTraceRegistry | undefined
): string {
  const projection = projectResolvedSecretModelContent(prompt, registry)
  if (!projection.safe || typeof projection.value !== 'string') {
    throw new Error('Mothership input could not be safely projected')
  }
  return projection.value
}

function projectMothershipMcpTools(
  tools: unknown,
  registry: ResolvedSecretTraceRegistry | undefined
): MothershipMcpToolSelection[] {
  if (!Array.isArray(tools)) return []

  return tools.flatMap((candidate) => {
    if (!isPlainRecord(candidate) || candidate.type !== 'mcp') return []
    if (candidate.usageControl === 'none' || !isPlainRecord(candidate.params)) return []

    const { serverId, toolName } = candidate.params
    if (
      typeof serverId !== 'string' ||
      !serverId ||
      typeof toolName !== 'string' ||
      !toolName ||
      !isResolvedSecretModelContentUnchanged([serverId, toolName], registry)
    ) {
      return []
    }

    const serverName =
      typeof candidate.params.serverName === 'string' ? candidate.params.serverName : undefined
    const schema = isPlainRecord(candidate.schema) ? candidate.schema : undefined
    const schemaContent = schema
      ? collectModelVisibleSchemaContent(schema)
      : { projectedValues: [], guardedValues: [] }
    if (!isResolvedSecretModelContentUnchanged(schemaContent.guardedValues, registry)) return []

    const projection = projectResolvedSecretModelContent(
      [serverName, schemaContent.projectedValues],
      registry
    )
    if (!projection.safe || !Array.isArray(projection.value) || projection.value.length !== 2) {
      throw new Error('Mothership MCP tool metadata could not be safely projected')
    }
    const [projectedServerName, projectedSchemaValues] = projection.value
    if (serverName === undefined && projectedServerName !== undefined) {
      throw new Error('Mothership MCP tool metadata could not be safely projected')
    }
    if (serverName !== undefined && typeof projectedServerName !== 'string') {
      throw new Error('Mothership MCP tool metadata could not be safely projected')
    }

    const projectedSchema = schema
      ? restoreModelVisibleSchemaValues(schema, projectedSchemaValues)
      : undefined
    if (projectedSchema !== undefined && !isPlainRecord(projectedSchema)) {
      throw new Error('Mothership MCP tool metadata could not be safely projected')
    }

    const usageControl =
      candidate.usageControl === 'auto' || candidate.usageControl === 'force'
        ? candidate.usageControl
        : undefined
    const selection: MothershipMcpToolSelection = {
      type: 'mcp',
      ...(usageControl ? { usageControl } : {}),
      ...(projectedSchema ? { schema: projectedSchema } : {}),
      params: {
        serverId,
        toolName,
        ...(projectedServerName !== undefined ? { serverName: projectedServerName } : {}),
      },
    }
    return [selection]
  })
}

function projectMothershipSkillContexts(
  skills: unknown,
  registry: ResolvedSecretTraceRegistry | undefined
): MothershipSkillContext[] {
  if (!Array.isArray(skills)) return []

  const selected = skills.flatMap((candidate) => {
    if (!isPlainRecord(candidate) || typeof candidate.skillId !== 'string' || !candidate.skillId) {
      return []
    }
    if (!isResolvedSecretModelContentUnchanged(candidate.skillId, registry)) return []
    return [
      {
        skillId: candidate.skillId,
        label: typeof candidate.name === 'string' ? candidate.name : candidate.skillId,
      },
    ]
  })
  const projection = projectResolvedSecretModelContent(
    selected.map((skill) => skill.label),
    registry
  )
  if (!projection.safe) {
    throw new Error('Mothership skill metadata could not be safely projected')
  }
  const projectedLabels = projection.value
  if (!Array.isArray(projectedLabels) || projectedLabels.length !== selected.length) {
    throw new Error('Mothership skill metadata could not be safely projected')
  }

  return selected.map((skill, index) => {
    const label = projectedLabels[index]
    if (typeof label !== 'string') {
      throw new Error('Mothership skill metadata could not be safely projected')
    }
    return { kind: 'skill', skillId: skill.skillId, label }
  })
}

async function consumeMothershipProvenance(
  payload: Partial<Record<typeof RESOLVED_SECRET_PROVENANCE_FIELD, unknown>>,
  response: Response,
  registry?: ResolvedSecretTraceRegistry
): Promise<boolean> {
  if (!registry) throw new Error('Mothership model-egress provenance registry is unavailable')

  const inspection = inspectPrivateToolMetadataEnvelope(
    response.headers,
    payload,
    RESOLVED_SECRET_PROVENANCE_METADATA_V1
  )
  const provenance = payload[RESOLVED_SECRET_PROVENANCE_FIELD]
  payload[RESOLVED_SECRET_PROVENANCE_FIELD] = undefined
  if (inspection.status === 'unsupported') {
    throw new Error('Mothership response does not support private provenance metadata')
  }
  if (inspection.status === 'invalid') {
    registry.markIncomplete()
    throw new Error('Mothership response provenance metadata is invalid')
  }

  const imported = await registry.importProvenanceForValue(provenance, payload, { trusted: true })
  if (!imported) throw new Error('Mothership response provenance metadata is invalid')
  return true
}

function assertMothershipResponseCapability(
  response: Response,
  registry: ResolvedSecretTraceRegistry | undefined
): void {
  if (!registry) throw new Error('Mothership model-egress provenance registry is unavailable')

  const capability = inspectPrivateToolMetadataResponseCapability(
    response.headers,
    RESOLVED_SECRET_PROVENANCE_METADATA_V1
  )
  if (capability.status === 'supported') return
  if (capability.status === 'mismatched') registry.markIncomplete()
  throw new Error('Mothership response does not support private provenance metadata')
}

function parseMothershipExecuteStreamLine(line: string): MothershipExecuteStreamEvent | undefined {
  const trimmed = line.trim()
  if (!trimmed) return undefined

  try {
    return JSON.parse(trimmed) as MothershipExecuteStreamEvent
  } catch {
    throw new Error('Sim execution stream returned malformed data')
  }
}

function formatMothershipBlockOutput(
  result: MothershipExecuteResult,
  fallbackChatId: string
): NormalizedBlockOutput {
  const formattedList = (result.toolCalls || []).map((tc: Record<string, unknown>) => ({
    name: typeof tc.name === 'string' ? tc.name : String(tc.name ?? ''),
    ...(typeof tc.status === 'string' ? { status: tc.status } : {}),
    arguments: (tc.arguments || tc.params || tc.input || {}) as Record<string, unknown>,
    result: (tc.result ?? tc.output) as any,
    error: typeof tc.error === 'string' ? tc.error : undefined,
    duration: typeof tc.durationMs === 'number' ? tc.durationMs : 0,
  }))
  const toolCalls: NormalizedBlockOutput['toolCalls'] = {
    list: formattedList,
    count: formattedList.length,
  }

  return {
    content: result.content || '',
    model: result.model || 'mothership',
    conversationId: result.conversationId || fallbackChatId,
    tokens: (result.tokens || {}) as NormalizedBlockOutput['tokens'],
    toolCalls,
    cost: result.cost as NormalizedBlockOutput['cost'] | undefined,
  }
}

function isContentSelectedForStreaming(ctx: ExecutionContext, block: SerializedBlock): boolean {
  if (!ctx.stream) return false

  return (
    ctx.selectedOutputs?.some((outputId) => {
      if (outputId === block.id) return true
      return outputId === `${block.id}.content` || outputId === `${block.id}_content`
    }) ?? false
  )
}

async function readMothershipExecuteResponse(
  response: Response,
  registry?: ResolvedSecretTraceRegistry
): Promise<MothershipExecuteResult> {
  assertMothershipResponseCapability(response, registry)
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('application/x-ndjson')) {
    let result: MothershipExecuteResult
    try {
      result = (await response.json()) as MothershipExecuteResult
    } catch {
      registry?.markIncomplete()
      throw new Error('Mothership response provenance metadata is invalid')
    }
    await consumeMothershipProvenance(result, response, registry)
    return result
  }

  if (!response.body) {
    throw new Error('Sim execution stream ended without a response body')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finalResult: MothershipExecuteResult | undefined
  let receivedTerminalProvenance = false

  const processLine = async (line: string): Promise<void> => {
    const event = parseMothershipExecuteStreamLine(line)
    if (!event) return

    if (event.type === 'heartbeat' || event.type === 'chunk') {
      return
    }

    if (event.type === 'error') {
      receivedTerminalProvenance = await consumeMothershipProvenance(event, response, registry)
      throw new Error(`Sim execution failed: ${event.error || 'Unknown error'}`)
    }

    if (event.type === 'final') {
      await consumeMothershipProvenance(event.data, response, registry)
      finalResult = event.data
      return
    }

    throw new Error('Sim execution stream returned an unknown event')
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        await processLine(line)
      }
    }

    buffer += decoder.decode()
    await processLine(buffer)

    if (!finalResult) {
      throw new Error('Sim execution stream ended without a final result')
    }

    return finalResult
  } finally {
    if (!finalResult && !receivedTerminalProvenance) registry?.markIncomplete()
    reader.releaseLock()
  }
}

function createMothershipStreamingExecution(
  response: Response,
  fallbackChatId: string,
  blockId: string,
  options: {
    onCancel?: (reason?: unknown) => void
    onDone?: () => void
    registry?: ResolvedSecretTraceRegistry
  } = {}
): StreamingExecution {
  assertMothershipResponseCapability(response, options.registry)
  if (!response.body) {
    throw new Error('Sim execution stream ended without a response body')
  }

  const output = formatMothershipBlockOutput({}, fallbackChatId)
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let cancelled = false
  let cleanedUp = false
  const cleanup = () => {
    if (cleanedUp) return
    cleanedUp = true
    options.onDone?.()
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      reader = response.body!.getReader()
      const decoder = new TextDecoder()
      const encoder = new TextEncoder()
      let buffer = ''
      let sawFinal = false
      let receivedTerminalProvenance = false

      const processLine = async (line: string): Promise<void> => {
        const event = parseMothershipExecuteStreamLine(line)
        if (!event) return

        if (event.type === 'heartbeat') {
          return
        }

        if (event.type === 'chunk') {
          if (event.content) {
            controller.enqueue(encoder.encode(event.content))
          }
          return
        }

        if (event.type === 'error') {
          receivedTerminalProvenance = await consumeMothershipProvenance(
            event,
            response,
            options.registry
          )
          throw new Error(`Sim execution failed: ${event.error || 'Unknown error'}`)
        }

        if (event.type === 'final') {
          await consumeMothershipProvenance(event.data, response, options.registry)
          sawFinal = true
          Object.assign(output, formatMothershipBlockOutput(event.data, fallbackChatId))
          return
        }

        throw new Error('Sim execution stream returned an unknown event')
      }

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (cancelled) return
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
          for (const line of lines) {
            await processLine(line)
          }
        }

        buffer += decoder.decode()
        await processLine(buffer)

        if (!sawFinal) {
          throw new Error('Sim execution stream ended without a final result')
        }

        if (!cancelled) {
          controller.close()
        }
      } catch (error) {
        if (!cancelled) {
          controller.error(error)
        }
      } finally {
        if (!sawFinal && !receivedTerminalProvenance) options.registry?.markIncomplete()
        cleanup()
        reader?.releaseLock()
      }
    },
    cancel(reason) {
      cancelled = true
      options.onCancel?.(reason)
      cleanup()
      return reader?.cancel(reason)
    },
  })

  return {
    stream,
    execution: {
      success: true,
      output,
      blockId,
      logs: [],
      metadata: {
        duration: 0,
        startTime: new Date().toISOString(),
      },
      isStreaming: true,
    } as StreamingExecution['execution'] & { blockId: string },
  }
}

async function buildMothershipFileAttachments(
  filesInput: unknown,
  ctx: ExecutionContext,
  requestId: string
): Promise<MothershipFileAttachment[] | undefined> {
  const files = normalizeFileInput(filesInput)
  if (!files || files.length === 0) {
    return undefined
  }

  if (!ctx.userId) {
    throw new Error('Mothership file attachments require an authenticated user.')
  }

  const userFiles = files.map((file) =>
    processSingleFileToUserFile(file as RawFileInput, requestId, logger)
  )
  const modelSafe = await areModelSafeWorkspaceFileKeys(
    userFiles.map((file) => file.key).filter((key): key is string => Boolean(key)),
    { workspaceId: ctx.workspaceId }
  )
  if (!modelSafe) throw new Error(MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE)

  const attachments: MothershipFileAttachment[] = []
  for (const userFile of userFiles) {
    const base64 = await readUserFileContent(userFile, {
      encoding: 'base64',
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
      workflowId: ctx.workflowId,
      executionId: ctx.executionId,
      largeValueExecutionIds: ctx.largeValueExecutionIds,
      largeValueKeys: ctx.largeValueKeys,
      fileKeys: ctx.fileKeys,
      allowLargeValueWorkflowScope: ctx.allowLargeValueWorkflowScope,
      requestId,
      logger,
      maxBytes: MAX_MOTHERSHIP_ATTACHMENT_BYTES,
      maxSourceBytes: MAX_MOTHERSHIP_ATTACHMENT_BYTES,
    })

    const content = createFileContentFromBase64(base64, userFile.type)
    if (!content) {
      throw new Error(`File type is not supported for Mothership attachments: ${userFile.name}`)
    }

    attachments.push({ ...content, filename: userFile.name })
  }

  return attachments
}

/**
 * Handler for Mothership blocks that proxy requests to the Mothership AI agent.
 *
 * Unlike the Agent block (which calls LLM providers directly), the Mothership
 * block delegates to the full Mothership infrastructure: main agent, subagents,
 * integration tools, memory, and workspace context.
 */
export class MothershipBlockHandler implements BlockHandler {
  canHandle(block: SerializedBlock): boolean {
    return block.metadata?.id === BlockType.MOTHERSHIP
  }

  async execute(
    ctx: ExecutionContext,
    block: SerializedBlock,
    inputs: Record<string, any>
  ): Promise<BlockOutput | StreamingExecution> {
    // Without the key the mothership rejects every request, so fail with
    // something the workflow author can act on instead of a bare 401.
    if (!env.COPILOT_API_KEY) {
      throw new Error('COPILOT_API_KEY is not configured, so the Sim Chat block cannot run')
    }

    const prompt = inputs.prompt
    if (!prompt || typeof prompt !== 'string') {
      throw new Error('Prompt input is required')
    }
    const messages = [
      {
        role: 'user' as const,
        content: projectMothershipPrompt(prompt, ctx.resolvedSecretTraceRegistry),
      },
    ]
    const providedConversationId =
      typeof inputs.conversationId === 'string' ? inputs.conversationId.trim() : ''
    const chatId = providedConversationId || generateId()
    const messageId = generateId()
    const requestId = generateId()
    const secretMountPolicy = normalizeSecretMountPolicy({
      secretScope: inputs.secretScope,
      mountedSecrets: inputs.mountedSecrets,
    })
    const fileAttachments = await buildMothershipFileAttachments(inputs.files, ctx, requestId)
    const mcpTools = projectMothershipMcpTools(inputs.tools, ctx.resolvedSecretTraceRegistry)
    const skillContexts = projectMothershipSkillContexts(
      inputs.skills,
      ctx.resolvedSecretTraceRegistry
    )

    const url = buildAPIUrl('/api/mothership/execute')
    const headers = await buildAuthHeaders(ctx.userId)
    headers.Accept = 'application/x-ndjson'
    headers[MOTHERSHIP_EXECUTE_STREAM_HEADER] = MOTHERSHIP_EXECUTE_STREAM_VALUE
    if (ctx.resolvedSecretTraceRegistry) {
      headers[PRIVATE_TOOL_METADATA_REQUEST_HEADER] = RESOLVED_SECRET_PROVENANCE_METADATA_V1
    }
    if (!ctx.metadata.billingAttribution) {
      throw new Error('Billing attribution is required for Mothership execution')
    }
    headers[BILLING_ATTRIBUTION_HEADER] = serializeBillingAttributionHeader(
      ctx.metadata.billingAttribution
    )

    const body: Record<string, unknown> = {
      messages,
      workspaceId: ctx.workspaceId || '',
      userId: ctx.userId || '',
      chatId,
      messageId,
      requestId,
      secretScope: secretMountPolicy.secretScope,
      mountedSecrets: secretMountPolicy.mountedSecrets,
      ...(fileAttachments && { fileAttachments }),
      ...(mcpTools.length > 0 ? { mcpTools } : {}),
      ...(skillContexts.length > 0 ? { contexts: skillContexts } : {}),
      ...(ctx.workflowId ? { workflowId: ctx.workflowId } : {}),
      ...(ctx.executionId ? { executionId: ctx.executionId } : {}),
    }

    logger.info('Executing Mothership block', {
      blockId: block.id,
      messageId,
      requestId,
      workflowId: ctx.workflowId,
      executionId: ctx.executionId,
      fileAttachmentCount: fileAttachments?.length ?? 0,
      mcpToolCount: mcpTools.length,
      skillCount: skillContexts.length,
    })

    const abortController = new AbortController()
    const onAbort = () => {
      if (!abortController.signal.aborted) {
        abortController.abort(ctx.abortSignal?.reason ?? 'workflow_abort')
      }
    }

    if (ctx.abortSignal?.aborted) {
      onAbort()
    } else {
      ctx.abortSignal?.addEventListener('abort', onAbort, { once: true })
    }

    const executionId = ctx.executionId
    const useRedisCancellation = isRedisCancellationEnabled() && !!executionId
    let pollInFlight = false
    const cancellationPoller =
      useRedisCancellation && executionId
        ? setInterval(() => {
            if (pollInFlight || abortController.signal.aborted) {
              return
            }
            pollInFlight = true
            void isExecutionCancelled(executionId)
              .then((cancelled) => {
                if (cancelled && !abortController.signal.aborted) {
                  abortController.abort('workflow_execution_cancelled')
                }
              })
              .catch((error) => {
                logger.warn('Failed to poll workflow cancellation for Mothership block', {
                  blockId: block.id,
                  executionId,
                  error: toError(error).message,
                })
              })
              .finally(() => {
                pollInFlight = false
              })
          }, CANCELLATION_CHECK_INTERVAL_MS)
        : undefined
    const cleanupAbortListeners = () => {
      if (cancellationPoller) {
        clearInterval(cancellationPoller)
      }
      ctx.abortSignal?.removeEventListener('abort', onAbort)
    }

    let response: Response
    let cleanupImmediately = true
    try {
      response = await fetch(url.toString(), {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: abortController.signal,
      })

      if (!response.ok) {
        assertMothershipResponseCapability(response, ctx.resolvedSecretTraceRegistry)
        let payload: MothershipExecuteResult
        try {
          payload = (await response.clone().json()) as MothershipExecuteResult
        } catch {
          ctx.resolvedSecretTraceRegistry?.markIncomplete()
          throw new Error('Mothership response provenance metadata is invalid')
        }
        await consumeMothershipProvenance(payload, response, ctx.resolvedSecretTraceRegistry)
        const errorMsg = await extractAPIErrorMessage(response)
        throw new Error(`Sim execution failed: ${errorMsg}`)
      }

      if (isContentSelectedForStreaming(ctx, block)) {
        const streamingExecution = createMothershipStreamingExecution(response, chatId, block.id, {
          onCancel: (reason) => {
            if (!abortController.signal.aborted) {
              abortController.abort(reason ?? 'mothership_stream_cancelled')
            }
          },
          onDone: cleanupAbortListeners,
          registry: ctx.resolvedSecretTraceRegistry,
        })
        cleanupImmediately = false
        return streamingExecution
      }

      const result = await readMothershipExecuteResponse(response, ctx.resolvedSecretTraceRegistry)
      return formatMothershipBlockOutput(result, chatId)
    } finally {
      if (cleanupImmediately) {
        cleanupAbortListeners()
      }
    }
  }
}
