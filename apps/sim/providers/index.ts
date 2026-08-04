import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { getApiKeyWithBYOK } from '@/lib/api-key/byok'
import {
  collectModelVisibleSchemaContent,
  restoreModelVisibleSchemaValues as restoreSchemaDisplayValues,
} from '@/lib/copilot/model-visible-schema'
import type { StreamingExecution } from '@/executor/types'
import {
  isResolvedSecretModelContentUnchanged,
  projectResolvedSecretModelContent,
  projectResolvedSecretModelJsonStrings,
} from '@/executor/utils/resolved-secret-content-projection'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import {
  applyModelCostPolicy,
  applySegmentCostPolicy,
  calculateBillableModelCost,
  installStreamingCostPolicy,
  type ModelCostPolicy,
  resolveModelCostPolicy,
  withoutToolCost,
} from '@/providers/cost-policy'
import {
  attachLargeFileRemoteUrls,
  uploadLargeFilesToProvider,
} from '@/providers/file-attachments.server'
import { isKnownModelId } from '@/providers/models'
import { getProviderExecutor } from '@/providers/registry'
import {
  type ProviderRuntimeContext,
  runWithProviderRuntimeContext,
} from '@/providers/runtime-context'
import type {
  Message,
  ProviderId,
  ProviderRequest,
  ProviderResponse,
  ProviderToolConfig,
} from '@/providers/types'
import {
  generateStructuredOutputInstructions,
  sumToolCosts,
  supportsPromptCaching,
  supportsReasoningEffort,
  supportsTemperature,
  supportsThinking,
  supportsVerbosity,
} from '@/providers/utils'

const logger = createLogger('Providers')

class ModelContentProjectionError extends Error {
  constructor() {
    super('Model input could not be safely projected')
    this.name = 'ModelContentProjectionError'
  }
}

function restoreProjectedOptionalString(
  original: string | undefined,
  candidate: unknown
): string | undefined {
  if (original === undefined && candidate === undefined) return undefined
  if (original === undefined || typeof candidate !== 'string') {
    throw new ModelContentProjectionError()
  }
  return candidate
}

function modelVisibleMessageText(message: Message): unknown[] {
  return [message.content, message.files?.map((file) => file.context)]
}

function projectMessageJsonArguments(
  messages: Message[] | undefined,
  registry: ResolvedSecretTraceRegistry | undefined
): Message[] | undefined {
  if (!messages) return undefined

  const argumentsToProject = messages.flatMap((message) => [
    message.function_call?.arguments,
    ...(message.tool_calls?.map((toolCall) => toolCall.function.arguments) ?? []),
  ])
  const projection = projectResolvedSecretModelJsonStrings(argumentsToProject, registry)
  if (!projection.safe || !Array.isArray(projection.value)) {
    throw new ModelContentProjectionError()
  }
  const projectedArguments = projection.value

  let cursor = 0
  return messages.map((message) => {
    const functionArguments = projectedArguments[cursor]
    cursor += 1
    const toolCalls = message.tool_calls?.map((toolCall) => {
      const toolArguments = projectedArguments[cursor]
      cursor += 1
      if (typeof toolArguments !== 'string') throw new ModelContentProjectionError()
      return {
        ...toolCall,
        function: { ...toolCall.function, arguments: toolArguments },
      }
    })
    if (message.function_call && typeof functionArguments !== 'string') {
      throw new ModelContentProjectionError()
    }
    return {
      ...message,
      ...(message.function_call
        ? {
            function_call: {
              ...message.function_call,
              arguments: functionArguments as string,
            },
          }
        : {}),
      ...(toolCalls ? { tool_calls: toolCalls } : {}),
    }
  })
}

function modelMessageProtocolHandles(messages: Message[] | undefined): unknown[] {
  return (messages ?? []).flatMap((message) => [
    message.name,
    message.function_call?.name,
    ...(message.tool_calls?.map((toolCall) => toolCall.function.name) ?? []),
  ])
}

function hasModelSafeSchema(
  schema: unknown,
  registry: ResolvedSecretTraceRegistry | undefined
): boolean {
  try {
    return isResolvedSecretModelContentUnchanged(
      collectModelVisibleSchemaContent(schema).guardedValues,
      registry
    )
  } catch {
    return false
  }
}

function modelSafeResponseFormatName(
  name: string,
  registry: ResolvedSecretTraceRegistry | undefined
): string | undefined {
  if (isResolvedSecretModelContentUnchanged(name, registry)) return name

  const prefixes = ['response', 'structured_output', 'model_output'] as const
  for (const prefix of prefixes) {
    for (let suffix = 0; suffix < 100; suffix += 1) {
      const candidate = `${prefix}_${suffix}`
      if (isResolvedSecretModelContentUnchanged(candidate, registry)) return candidate
    }
  }
  return undefined
}

function restoreProjectedMessages(
  original: Message[] | undefined,
  projected: unknown
): Message[] | undefined {
  if (original === undefined && projected === undefined) return undefined
  if (!original || !Array.isArray(projected) || original.length !== projected.length) {
    throw new ModelContentProjectionError()
  }

  return projected.map((candidate, index) => {
    if (!Array.isArray(candidate) || candidate.length !== 2) {
      throw new ModelContentProjectionError()
    }
    const originalMessage = original[index]
    const [content, fileContexts] = candidate
    if (
      (originalMessage.content === null && content !== null) ||
      (typeof originalMessage.content === 'string' && typeof content !== 'string')
    ) {
      throw new ModelContentProjectionError()
    }

    let projectedFiles: Message['files']
    if (originalMessage.files === undefined && fileContexts === undefined) {
      projectedFiles = undefined
    } else {
      if (
        !originalMessage.files ||
        !Array.isArray(fileContexts) ||
        originalMessage.files.length !== fileContexts.length
      ) {
        throw new ModelContentProjectionError()
      }
      projectedFiles = originalMessage.files.map((file, fileIndex) => {
        const context = restoreProjectedOptionalString(file.context, fileContexts[fileIndex])
        return { ...file, context }
      })
    }

    return {
      ...originalMessage,
      content: content as Message['content'],
      ...(projectedFiles !== undefined ? { files: projectedFiles } : {}),
    }
  })
}

function modelVisibleToolContent(tool: ProviderToolConfig): unknown[] {
  return [tool.description, collectModelVisibleSchemaContent(tool.parameters).projectedValues]
}

function restoreProjectedTools(
  original: ProviderToolConfig[] | undefined,
  projected: unknown
): ProviderToolConfig[] | undefined {
  if (original === undefined && projected === undefined) return undefined
  if (!original || !Array.isArray(projected) || original.length !== projected.length) {
    throw new ModelContentProjectionError()
  }

  return projected.map((candidate, index) => {
    if (!Array.isArray(candidate) || candidate.length !== 2 || typeof candidate[0] !== 'string') {
      throw new ModelContentProjectionError()
    }
    return {
      ...original[index],
      description: candidate[0],
      parameters: restoreSchemaDisplayValues(
        original[index].parameters,
        candidate[1]
      ) as ProviderToolConfig['parameters'],
    }
  })
}

function projectProviderModelContent(
  request: ProviderRequest,
  runtimeContext: ProviderRuntimeContext
): ProviderRequest {
  const registry = runtimeContext.resolvedSecretTraceRegistry
  if (
    !isResolvedSecretModelContentUnchanged(modelMessageProtocolHandles(request.messages), registry)
  ) {
    throw new ModelContentProjectionError()
  }

  const sourceMessages = projectMessageJsonArguments(request.messages, registry)
  const sourceTools = request.tools?.filter(
    (tool) =>
      isResolvedSecretModelContentUnchanged(tool.id, registry) &&
      isResolvedSecretModelContentUnchanged(tool.name, registry) &&
      hasModelSafeSchema(tool.parameters, registry)
  )
  let sourceResponseFormat = request.responseFormat
  if (request.responseFormat) {
    if (!hasModelSafeSchema(request.responseFormat.schema, registry)) {
      throw new ModelContentProjectionError()
    }
    const name = modelSafeResponseFormatName(request.responseFormat.name, registry)
    if (!name) throw new ModelContentProjectionError()
    sourceResponseFormat = { ...request.responseFormat, name }
  }

  const projection = projectResolvedSecretModelContent(
    [
      request.systemPrompt,
      request.context,
      sourceMessages?.map(modelVisibleMessageText),
      sourceTools?.map(modelVisibleToolContent),
      sourceResponseFormat
        ? collectModelVisibleSchemaContent(sourceResponseFormat.schema).projectedValues
        : undefined,
    ],
    registry
  )
  if (!projection.safe || !Array.isArray(projection.value) || projection.value.length !== 5) {
    throw new ModelContentProjectionError()
  }

  const [systemPrompt, context, projectedMessages, projectedTools, responseSchemaDisplay] =
    projection.value
  const projectedSystemPrompt = restoreProjectedOptionalString(request.systemPrompt, systemPrompt)
  const projectedContext = restoreProjectedOptionalString(request.context, context)
  let responseFormat = sourceResponseFormat
  if (sourceResponseFormat) {
    responseFormat = {
      ...sourceResponseFormat,
      schema: restoreSchemaDisplayValues(sourceResponseFormat.schema, responseSchemaDisplay),
    }
  } else if (responseSchemaDisplay !== undefined) {
    throw new ModelContentProjectionError()
  }

  return {
    ...request,
    systemPrompt: projectedSystemPrompt,
    context: projectedContext,
    messages: restoreProjectedMessages(sourceMessages, projectedMessages),
    tools: restoreProjectedTools(sourceTools, projectedTools),
    responseFormat,
  }
}

function projectProviderAttachmentDisplayNames(
  request: ProviderRequest,
  runtimeContext: ProviderRuntimeContext
): ProviderRequest {
  const fileNames = (request.messages ?? []).map((message) =>
    message.files ? message.files.map((file) => file.name) : null
  )
  const projection = projectResolvedSecretModelContent(
    fileNames,
    runtimeContext.resolvedSecretTraceRegistry
  )
  if (!projection.safe || !Array.isArray(projection.value)) {
    throw new ModelContentProjectionError()
  }

  const projectedFileNames = projection.value
  if (projectedFileNames.length !== (request.messages?.length ?? 0)) {
    throw new ModelContentProjectionError()
  }

  return {
    ...request,
    messages: request.messages?.map((message, messageIndex) => {
      const candidate = projectedFileNames[messageIndex]
      if (!message.files) {
        if (candidate !== null) throw new ModelContentProjectionError()
        return message
      }
      if (!Array.isArray(candidate) || candidate.length !== message.files.length) {
        throw new ModelContentProjectionError()
      }

      return {
        ...message,
        files: message.files.map((file, fileIndex) => {
          const name = candidate[fileIndex]
          if (typeof name !== 'string') throw new ModelContentProjectionError()
          return { ...file, name }
        }),
      }
    }),
  }
}

/**
 * Maximum number of iterations for tool call loops to prevent infinite loops.
 * Used across all providers that support tool/function calling.
 */
export const MAX_TOOL_ITERATIONS = 20

/**
 * Normalizes a model-tuning level that may have arrived from a variable or block reference
 * rather than a picker. Every level a model declares is lower-case, so trimming and
 * lower-casing lets a reference resolve to `"High"` or `" high "` and still apply. A level
 * that resolves to nothing becomes `undefined` so the field reads as untouched instead of
 * sending an empty string the provider rejects.
 */
function normalizeModelLevel(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  return normalized || undefined
}

function sanitizeRequest(request: ProviderRequest): ProviderRequest {
  const sanitizedRequest = { ...request }
  const model = sanitizedRequest.model

  sanitizedRequest.reasoningEffort = normalizeModelLevel(sanitizedRequest.reasoningEffort)
  sanitizedRequest.verbosity = normalizeModelLevel(sanitizedRequest.verbosity)
  sanitizedRequest.thinkingLevel = normalizeModelLevel(sanitizedRequest.thinkingLevel)

  if (model && !supportsTemperature(model)) {
    sanitizedRequest.temperature = undefined
  }

  /**
   * A model absent from the catalogue is unknown, not known-incapable. The model field is an
   * editable combobox, so a model newer than `models.ts` reaches this point routed by pattern
   * and executing normally — discarding its levels on the strength of a list that has not
   * caught up loses a setting the provider would have honoured. Those levels are forwarded and
   * the provider decides. Models the catalogue does know, and every dynamic-provider id, keep
   * the protective drop.
   */
  const isCatalogued = Boolean(model) && isKnownModelId(model)

  if (model && isCatalogued && !supportsReasoningEffort(model)) {
    sanitizedRequest.reasoningEffort = undefined
  }

  if (model && isCatalogued && !supportsVerbosity(model)) {
    sanitizedRequest.verbosity = undefined
  }

  if (model && isCatalogued && !supportsThinking(model)) {
    sanitizedRequest.thinkingLevel = undefined
  }

  if (model && !supportsPromptCaching(model)) {
    sanitizedRequest.promptCaching = undefined
  }

  return sanitizedRequest
}

function isStreamingExecution(response: any): response is StreamingExecution {
  return response && typeof response === 'object' && 'stream' in response && 'execution' in response
}

function isReadableStream(response: any): response is ReadableStream {
  return response instanceof ReadableStream
}

/**
 * Applies the shared model-cost policy to a streaming response.
 *
 * The streaming and non-streaming paths must charge identically for the same
 * model and tokens, but streaming providers write their cost from inside the
 * stream drain — long after this function returns — so the policy is installed
 * on the live output object rather than applied to a value.
 */
function applyStreamingCostPolicy(response: StreamingExecution, policy: ModelCostPolicy): void {
  const output = response.execution?.output
  if (!output || typeof output !== 'object') {
    logger.warn('Streaming output unavailable at intercept time; cost policy not applied')
    return
  }

  installStreamingCostPolicy(output, policy)

  const segments = output.providerTiming?.timeSegments
  if (Array.isArray(segments)) {
    applySegmentCostPolicy(segments, policy)
  }
}

export async function executeProviderRequest(
  providerId: string,
  request: ProviderRequest,
  runtimeContext?: ProviderRuntimeContext
): Promise<ProviderResponse | ReadableStream | StreamingExecution> {
  const provider = await getProviderExecutor(providerId as ProviderId)
  if (!provider) {
    throw new Error(`Provider not found: ${providerId}`)
  }

  if (!provider.executeRequest) {
    throw new Error(`Provider ${providerId} does not implement executeRequest`)
  }

  runtimeContext?.resolvedSecretTraceRegistry?.addModelEgressValues(
    request.environmentVariables ?? {}
  )

  let resolvedRequest = sanitizeRequest(request)
  let isBYOK = false

  if (request.workspaceId) {
    try {
      const result = await getApiKeyWithBYOK(
        providerId,
        request.model,
        request.workspaceId,
        request.apiKey
      )
      resolvedRequest = { ...resolvedRequest, apiKey: result.apiKey }
      isBYOK = result.isBYOK
      logger.info('API key resolved', {
        provider: providerId,
        model: request.model,
        workspaceId: request.workspaceId,
        isBYOK,
      })
    } catch (error) {
      logger.error('Failed to resolve API key:', {
        provider: providerId,
        model: request.model,
        error: toError(error).message,
      })
      throw error
    }
  }

  resolvedRequest.isBYOK = isBYOK
  const sanitizedRequest = resolvedRequest

  if (sanitizedRequest.responseFormat) {
    if (
      typeof sanitizedRequest.responseFormat === 'string' &&
      sanitizedRequest.responseFormat === ''
    ) {
      logger.info('Empty response format provided, ignoring it')
      sanitizedRequest.responseFormat = undefined
    } else {
      const structuredOutputInstructions = generateStructuredOutputInstructions(
        sanitizedRequest.responseFormat
      )

      if (structuredOutputInstructions.trim()) {
        const originalPrompt = sanitizedRequest.systemPrompt || ''
        sanitizedRequest.systemPrompt =
          `${originalPrompt}\n\n${structuredOutputInstructions}`.trim()

        logger.info('Added structured output instructions to system prompt')
      }
    }
  }

  const attachmentRequest = runtimeContext
    ? projectProviderAttachmentDisplayNames(sanitizedRequest, runtimeContext)
    : sanitizedRequest

  await attachLargeFileRemoteUrls(attachmentRequest, providerId)
  await uploadLargeFilesToProvider(attachmentRequest, providerId)

  const modelSafeRequest = runtimeContext
    ? projectProviderModelContent(attachmentRequest, runtimeContext)
    : attachmentRequest

  const response = await runWithProviderRuntimeContext(runtimeContext, () =>
    provider.executeRequest(modelSafeRequest)
  )

  if (isStreamingExecution(response)) {
    logger.info('Provider returned StreamingExecution', { isBYOK })
    applyStreamingCostPolicy(response, resolveModelCostPolicy(sanitizedRequest.model, isBYOK))
    return response
  }

  if (isReadableStream(response)) {
    logger.info('Provider returned ReadableStream')
    return response
  }

  const costPolicy = resolveModelCostPolicy(response.model, isBYOK)

  if (response.tokens) {
    const { input: promptTokens = 0, output: completionTokens = 0 } = response.tokens

    /**
     * Any provider that reports cache buckets also prices itself, because only
     * it knows the tiers involved — Anthropic's 5m vs 1h writes cannot be
     * reconstructed from a single `cacheWrite` count. Its cost is therefore
     * authoritative and only the policy is applied on top. The fallback prices
     * providers that report no cache usage at all.
     *
     * Tool cost is stripped either way: it is re-derived from `toolResults`
     * below and must not be counted twice.
     */
    response.cost = response.cost
      ? (applyModelCostPolicy(withoutToolCost(response.cost), costPolicy) as typeof response.cost)
      : calculateBillableModelCost(response.model, promptTokens, completionTokens, { isBYOK })

    if (!costPolicy.billable) {
      logger.info(
        isBYOK
          ? `Not billing model usage for ${response.model} - workspace BYOK key used`
          : `Not billing model usage for ${response.model} - user provided API key or not hosted model`
      )
    }
  }

  // Per-segment model costs are written by trace enrichers regardless of key
  // provenance. Align them with the block-level decision so the displayed
  // breakdown does not contradict the authoritative block cost.
  if (response.timing?.timeSegments) {
    applySegmentCostPolicy(response.timing.timeSegments, costPolicy)
  }

  const toolCost = sumToolCosts(response.toolResults)
  if (toolCost > 0 && response.cost) {
    // Replaced rather than mutated: a provider-supplied cost can be the same
    // object it also handed to a time segment, and tool cost belongs only to
    // the block total.
    response.cost = {
      ...response.cost,
      toolCost,
      total: response.cost.total + toolCost,
    }
  }

  return response
}
