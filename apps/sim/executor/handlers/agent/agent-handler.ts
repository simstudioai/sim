import { db } from '@sim/db'
import { mcpServers } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { isPlainRecord } from '@sim/utils/object'
import { truncate } from '@sim/utils/string'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { normalizeStringRecord, normalizeWorkflowVariables } from '@/lib/core/utils/records'
import {
  projectModelSchemaAnnotations,
  projectResolvedModelInput,
  selectModelSchemaInputPaths,
} from '@/lib/execution/model-input-provenance'
import { readAvailableCustomToolByIdOrTitleAsExecutor } from '@/lib/internal/custom-tools/read-available-by-id-or-title'
import { discoverMcpServerToolsAsExecutor } from '@/lib/internal/mcp/discover-tools'
import {
  readWorkflowInputFieldsForTool,
  readWorkflowMetadataForTool,
} from '@/lib/internal/workflows/read-tool-enrichment'
import { assertValidMcpServerToolBindings, MCP_SERVER_ADVANCED_TOOL_TYPE } from '@/lib/mcp/shared'
import type { McpToolSchema } from '@/lib/mcp/types'
import {
  createMcpToolId,
  isManagedMcpConnectionId,
  MANAGED_MCP_CONNECTION_PREFIX,
} from '@/lib/mcp/utils'
import {
  type AutoMediaKind,
  type AutoRoutingResult,
  type AutoRoutingSignals,
  resolveAutoModel,
  SIM_AUTO_SYSTEM_PREAMBLE,
} from '@/lib/model-router/resolve'
import { importWorkspaceFileSecretProvenanceForModelView } from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import {
  getFileExtension,
  MODEL_SUPPORTED_IMAGE_MIME_TYPES,
  processFilesToUserFiles,
  type RawFileInput,
} from '@/lib/uploads/utils/file-utils'
import { selectModelBoundFileInputPaths } from '@/lib/uploads/utils/model-input'
import { hydrateUserFilesWithBase64 } from '@/lib/uploads/utils/user-file-base64.server'
import { resolveCustomBlockToolBinding } from '@/lib/workflows/custom-blocks/operations'
import { getAllBlocks, getBlock } from '@/blocks'
import { assembleCustomBlockInputMapping, isCustomBlockType } from '@/blocks/custom/build-config'
import type { BlockOutput } from '@/blocks/types'
import { normalizeFileInput } from '@/blocks/utils'
import {
  assertPermissionsAllowed,
  validateBlockType,
  validateModelProvider,
} from '@/ee/access-control/utils/permission-check'
import { AGENT, BlockType, DEFAULTS, stripCustomToolPrefix } from '@/executor/constants'
import { memoryService } from '@/executor/handlers/agent/memory'
import {
  buildLoadSkillTool,
  buildSkillsSystemPromptSection,
  resolveSkillMetadata,
} from '@/executor/handlers/agent/skills-resolver'
import type {
  AgentInputs,
  Message,
  StreamingConfig,
  ToolInput,
} from '@/executor/handlers/agent/types'
import { parseResponseFormat } from '@/executor/handlers/shared/response-format'
import type { BlockHandler, ExecutionContext, StreamingExecution } from '@/executor/types'
import { collectBlockData } from '@/executor/utils/block-data'
import { stringifyJSON } from '@/executor/utils/json'
import { projectResolvedSecretDiagnosticContent } from '@/executor/utils/resolved-secret-content-projection'
import { prepareResolvedSecretProjectedInputs } from '@/executor/utils/resolved-secret-input-projection'
import { refuseResolvedSecretProjection } from '@/executor/utils/resolved-secret-projection-refusal'
import type {
  ResolvedSecretInputPath,
  ResolvedSecretTraceRegistry,
} from '@/executor/utils/resolved-secret-trace-registry'
import { annotateDuplicateToolBindings } from '@/executor/utils/tool-binding-labels'
import { resolveVertexCredential } from '@/executor/utils/vertex-credential'
import { executeProviderRequest } from '@/providers'
import {
  formatAttachmentSizes,
  getProviderFileStrategy,
  isProviderAttachmentFilenameModelBound,
  shouldUseLargeFilePath,
  supportsFileAttachments,
} from '@/providers/attachments'
import {
  canUseProviderLargeFilePath,
  getInlineHydrationMaxBytes,
} from '@/providers/file-attachments.server'
import { isAutoModel, SIM_AUTO_MODEL_ID } from '@/providers/models'
import {
  type ProviderToolInputProvenance,
  registerProviderToolInputProvenance,
  registerProviderToolModelInputRegistry,
} from '@/providers/tool-input-provenance'
import type { ProviderToolConfig } from '@/providers/types'
import { getProviderFromModel, transformBlockTool } from '@/providers/utils'
import type { SerializedBlock } from '@/serializer/types'
import { buildJsonSchemaParamShapes, decodeToolParams } from '@/tools/param-shape'
import { filterSchemaForLLM, type ToolSchema, ToolSchemaEnrichmentError } from '@/tools/params'
import { getTool } from '@/tools/utils'
import { getToolAsync } from '@/tools/utils.server'

const logger = createLogger('AgentBlockHandler')
const MODEL_SAFE_RESPONSE_FORMAT_NAME = 'response_schema'
const AGENT_MODEL_INPUT_REFUSAL = 'Agent model input could not be safely projected'
const AGENT_TOOL_INPUT_REFUSAL = 'Agent tool input could not be safely projected'
const AGENT_PRIVATE_SELECTOR_REFUSAL = 'Agent private selector could not be safely projected'
const toAgentToolInputSafetyError = (message: string) => new AgentToolInputSafetyError(message)

const AGENT_RAW_PROVIDER_ERROR_INPUT_PATHS: readonly ResolvedSecretInputPath[] = [
  ['model'],
  ['temperature'],
  ['maxTokens'],
  ['apiKey'],
  ['azureEndpoint'],
  ['azureApiVersion'],
  ['vertexProject'],
  ['vertexLocation'],
  ['vertexCredential'],
  ['bedrockAccessKeyId'],
  ['bedrockSecretKey'],
  ['bedrockRegion'],
  ['reasoningEffort'],
  ['verbosity'],
  ['thinkingLevel'],
  ['promptCaching'],
  ['previousInteractionId'],
]

interface IndexedToolInput {
  tool: ToolInput
  toolIndex: number
}

interface FormattedAgentTools {
  tools: ProviderToolConfig[]
  inputProvenance: Map<ProviderToolConfig, Omit<ProviderToolInputProvenance, 'registry'>>
}

class AgentToolInputSafetyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgentToolInputSafetyError'
  }
}

function projectAgentDiagnosticMetadata(
  ctx: ExecutionContext,
  metadata: Record<string, unknown>,
  fallback: Record<string, unknown>
): Record<string, unknown> {
  const projection = projectResolvedSecretDiagnosticContent(
    metadata,
    ctx.resolvedSecretTraceRegistry
  )
  return projection.safe && isPlainRecord(projection.value) ? projection.value : fallback
}

function getErrorDiagnosticMetadata(error: unknown): Record<string, unknown> {
  const normalizedError = toError(error)
  return {
    errorName: normalizedError.name,
    errorMessage: normalizedError.message,
    ...(normalizedError.stack ? { errorStack: normalizedError.stack } : {}),
  }
}

function getErrorDiagnosticFallback(error: unknown): Record<string, unknown> {
  return {
    errorType: error instanceof Error ? 'error' : typeof error,
  }
}

function getToolDiagnosticMetadata(tool: ToolInput): Record<string, unknown> {
  return {
    toolType: tool.type,
    customToolId: tool.customToolId,
    title: tool.title,
    operation: tool.operation,
    usageControl: tool.usageControl,
    toolName: tool.params?.toolName,
    serverId: tool.params?.serverId,
    hasSchema: tool.schema !== undefined,
    hasParams: tool.params !== undefined,
  }
}

function getToolDiagnosticFallback(tool: ToolInput): Record<string, unknown> {
  return {
    hasToolType: typeof tool.type === 'string',
    hasCustomToolId: typeof tool.customToolId === 'string',
    hasToolName: typeof tool.params?.toolName === 'string',
    hasServerId: typeof tool.params?.serverId === 'string',
    hasSchema: tool.schema !== undefined,
    hasParams: tool.params !== undefined,
  }
}

/**
 * True when a failure originated from a transport deadline or abort, at any depth of the
 * cause chain.
 *
 * Providers rewrap transport failures (`ProviderError` overwrites `name`), so a check on
 * the top-level `name` alone misses every wrapped case. Bounded to a short walk so a
 * self-referential cause cannot loop.
 */
function isTransportTimeout(error: unknown): boolean {
  for (let current = error, depth = 0; current instanceof Error && depth < 5; depth++) {
    if (current.name === 'AbortError' || current.name === 'TimeoutError') return true
    current = current.cause
  }
  return false
}

/**
 * Handler for Agent blocks that process LLM requests with optional tools.
 */
export class AgentBlockHandler implements BlockHandler {
  canHandle(block: SerializedBlock): boolean {
    return block.metadata?.id === BlockType.AGENT
  }

  async execute(
    ctx: ExecutionContext,
    block: SerializedBlock,
    inputs: AgentInputs
  ): Promise<BlockOutput | StreamingExecution> {
    const providerErrorRegistry = ctx.resolvedSecretTraceRegistry?.forkForInputPaths(
      AGENT_RAW_PROVIDER_ERROR_INPUT_PATHS
    )
    ctx.errorResolvedSecretTraceRegistry = providerErrorRegistry
    const toolIndexByRef = new Map<ToolInput, number>(
      (inputs.tools || []).map((tool, index) => [tool, index] as const)
    )
    const privateAgentSelectorInputPaths: ResolvedSecretInputPath[] = []
    let responseFormatModelInputPaths: ResolvedSecretInputPath[] = []
    let privateAgentSelectorsSettled = false
    const settlePrivateAgentSelectors = (): void => {
      if (privateAgentSelectorsSettled) return
      privateAgentSelectorsSettled = true
      this.settlePrivateAgentSelectors(
        ctx,
        inputs,
        privateAgentSelectorInputPaths,
        responseFormatModelInputPaths
      )
    }

    try {
      const privateAgentSelectors = this.getPrivateAgentSelectorInputPaths(ctx, inputs, [])
      privateAgentSelectorInputPaths.push(...privateAgentSelectors.inputPaths)
      if (!privateAgentSelectors.complete) {
        refuseResolvedSecretProjection({
          site: 'agent.privateSelectorProvenance',
          message: AGENT_PRIVATE_SELECTOR_REFUSAL,
          registry: ctx.resolvedSecretTraceRegistry,
          inputPath: 'responseFormat,tools,skills',
          createError: toAgentToolInputSafetyError,
        })
      }
      const responseFormatProjection = this.projectResponseFormatForModel(
        ctx,
        inputs,
        (privateNameInputPaths) => {
          privateAgentSelectorInputPaths.push(...privateNameInputPaths)
        }
      )
      responseFormatModelInputPaths = responseFormatProjection.inputPaths
      const filteredTools = await this.filterUnavailableMcpTools(ctx, inputs.tools || [])
      const filteredInputs = { ...inputs, tools: filteredTools }
      this.assertInputPathsDoNotResolveSecrets(
        ctx,
        this.getMessageStructuralInputPaths(filteredInputs),
        'Agent structural model inputs cannot contain secret references'
      )
      const fileProjection = this.projectFileNamesForModel(ctx, filteredInputs)
      const coreModelInputPaths = this.getModelInputPaths(filteredInputs)
      const modelInputProjection = projectResolvedModelInput(
        ctx.resolvedSecretTraceRegistry,
        {
          systemPrompt: filteredInputs.systemPrompt,
          userPrompt: filteredInputs.userPrompt,
          messages: filteredInputs.messages,
          memories: filteredInputs.memories,
        },
        coreModelInputPaths
      )
      if (!modelInputProjection.complete) {
        refuseResolvedSecretProjection({
          site: 'agent.coreModelInput',
          message: AGENT_MODEL_INPUT_REFUSAL,
          registry: ctx.resolvedSecretTraceRegistry,
        })
      }
      const modelInputs: AgentInputs = {
        ...filteredInputs,
        ...modelInputProjection.value,
        responseFormat: responseFormatProjection.value,
      }
      const projectedToolInputs = this.projectToolInputsForProvenance(ctx, inputs.tools || [])

      await this.validateToolPermissions(ctx, filteredInputs.tools || [])

      const responseFormat = parseResponseFormat(modelInputs.responseFormat)
      const configuredModel = filteredInputs.model || AGENT.DEFAULT_MODEL

      let model = configuredModel
      let autoRouting: AutoRoutingResult | null = null
      if (isAutoModel(configuredModel)) {
        autoRouting = await resolveAutoModel({
          ctx,
          blockId: block.id,
          signals: this.buildAutoRoutingSignals(
            {
              ...modelInputs,
              systemPrompt: filteredInputs.systemPrompt ? modelInputs.systemPrompt : undefined,
              userPrompt: filteredInputs.userPrompt
                ? modelInputs.userPrompt
                : filteredInputs.userPrompt,
            },
            responseFormat
          ),
          fallbackModel: AGENT.DEFAULT_MODEL,
        })
        model = autoRouting.model
        logger.info(
          'Resolved sim-auto model',
          projectAgentDiagnosticMetadata(
            ctx,
            {
              blockId: block.id,
              model,
              tier: autoRouting.tier,
              decidedBy: autoRouting.decidedBy,
            },
            {
              blockId: block.id,
              tier: autoRouting.tier,
              decidedBy: autoRouting.decidedBy,
            }
          )
        )
        // Hidden identity preamble for every auto execution (fallback included):
        // keeps pool models in English by default and off the topic of which
        // underlying model they are. Applied after signal building so the
        // preamble never influences classification.
        modelInputs.systemPrompt = [SIM_AUTO_SYSTEM_PREAMBLE, modelInputs.systemPrompt]
          .filter(Boolean)
          .join('\n\n')
      }

      await validateModelProvider(ctx.userId, ctx.workspaceId, model, ctx)

      const providerId = getProviderFromModel(model)
      const formatted = await this.formatTools(
        ctx,
        filteredInputs.tools || [],
        block.canonicalModes,
        toolIndexByRef,
        projectedToolInputs
      )

      const skillInputs = filteredInputs.skills ?? []
      let skillMetadata: Array<{ name: string; description: string }> = []
      if (skillInputs.length > 0 && ctx.workspaceId) {
        await assertPermissionsAllowed({
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
          toolKind: 'skill',
          ctx,
        })
        skillMetadata = await resolveSkillMetadata(skillInputs, ctx.workspaceId)
        if (skillMetadata.length > 0) {
          const skillNames = skillMetadata.map((s) => s.name)
          formatted.tools.push(buildLoadSkillTool(skillNames))
        }
      }

      const streamingConfig = this.getStreamingConfig(ctx, block)
      const messages = await this.buildMessages(ctx, filteredInputs, modelInputs, skillMetadata)
      const messagesWithInputFiles = this.attachFilesToLastUserMessage(
        ctx,
        messages,
        filteredInputs.files,
        fileProjection.projectedFiles,
        fileProjection.projectedNameByFile,
        fileProjection.directNameInputPaths
      )
      const messagesWithFiles = await this.hydrateMessageFilesForProvider(
        ctx,
        messagesWithInputFiles,
        providerId,
        fileProjection.projectedNameByFile,
        fileProjection.modelBoundInputPaths
      )

      const providerRequest = this.buildProviderRequest({
        ctx,
        providerId,
        model,
        messages: messagesWithFiles,
        inputs: modelInputs,
        formattedTools: formatted.tools,
        responseFormat,
        streaming: streamingConfig.shouldUseStreaming ?? false,
      })

      settlePrivateAgentSelectors()

      const settledInputRegistry = ctx.resolvedSecretTraceRegistry
      const resultRegistry = settledInputRegistry?.forkForInputPaths([])
      if (modelInputProjection.registry) {
        for (const tool of formatted.tools) {
          registerProviderToolModelInputRegistry(tool, modelInputProjection.registry)
        }
      }
      if (resultRegistry && settledInputRegistry) {
        for (const [tool, provenance] of formatted.inputProvenance) {
          registerProviderToolInputProvenance(tool, {
            ...provenance,
            registry: settledInputRegistry,
          })
        }
      }
      const result = await this.executeProviderRequest(
        ctx,
        providerRequest,
        block,
        responseFormat,
        resultRegistry,
        providerErrorRegistry
      )
      if (resultRegistry) ctx.resolvedSecretTraceRegistry = resultRegistry

      if (autoRouting && autoRouting.billableRoutingCost > 0) {
        this.applyRoutingCost(result, autoRouting.billableRoutingCost)
      }

      if (autoRouting) {
        this.applyAutoModelLabel(result, model)
      }

      if (this.isStreamingExecution(result)) {
        const streamingResult = result as StreamingExecution
        streamingResult.diagnosticResolvedSecretTraceRegistry = providerErrorRegistry
        if (filteredInputs.memoryType && filteredInputs.memoryType !== 'none') {
          return this.wrapStreamForMemoryPersistence(ctx, filteredInputs, streamingResult)
        }
        return streamingResult
      }

      if (filteredInputs.memoryType && filteredInputs.memoryType !== 'none') {
        await this.persistResponseToMemory(ctx, filteredInputs, result as BlockOutput)
      }

      return result
    } finally {
      settlePrivateAgentSelectors()
    }
  }

  /**
   * Derives the compact routing signals for sim-auto resolution from the
   * block's resolved inputs. Excerpts only — the resolver truncates further
   * and mothership re-clamps server-side.
   */
  private buildAutoRoutingSignals(inputs: AgentInputs, responseFormat: any): AutoRoutingSignals {
    const lastMessage =
      typeof inputs.userPrompt === 'string'
        ? inputs.userPrompt
        : inputs.userPrompt != null
          ? stringifyJSON(inputs.userPrompt)
          : (inputs.messages?.at(-1)?.content ?? '')
    const systemPrompt = inputs.systemPrompt ?? ''
    const normalizedFiles = normalizeFileInput(inputs.files)
    const approxChars =
      systemPrompt.length +
      lastMessage.length +
      (inputs.messages ? stringifyJSON(inputs.messages).length : 0)

    return {
      systemPrompt,
      lastMessage,
      messageCount: (inputs.messages?.length ?? 0) + (inputs.userPrompt ? 1 : 0),
      toolNames: (inputs.tools ?? []).map((t) => t.title || t.type || 'tool'),
      mediaKind: this.resolveMediaKind(inputs, normalizedFiles),
      hasResponseFormat: Boolean(responseFormat),
      approxInputTokens: Math.ceil(approxChars / 4),
    }
  }

  /**
   * Classifies what the block attaches, which decides the sim-auto pool column.
   *
   * Media reaches the provider by two routes — the block's `files` input and
   * files already carried on inbound messages (chat deployments, memory, an
   * upstream block feeding `messages`) — and both count. A file whose MIME type
   * is missing or unrecognized counts as `file`, the column served by the
   * providers that accept the most input types, because the alternative is
   * handing a document to a model whose API models no such content part.
   */
  private resolveMediaKind(inputs: AgentInputs, normalizedFiles: unknown): AutoMediaKind {
    const attached: Array<{ type?: string }> = [
      ...(Array.isArray(normalizedFiles) ? (normalizedFiles as Array<{ type?: string }>) : []),
      ...(inputs.messages ?? []).flatMap((message) => message.files ?? []),
    ]

    if (attached.length === 0) return 'none'

    return attached.every((file) =>
      MODEL_SUPPORTED_IMAGE_MIME_TYPES.has((file.type ?? '').toLowerCase())
    )
      ? 'image'
      : 'file'
  }

  /**
   * Reports a completed auto run under the `sim-auto` identity everywhere the
   * run is observed — the block output, the trace span, and the usage-ledger
   * row keyed on the model name — so the pool model that served the request
   * stays an implementation detail (matching the block's configured model and
   * the hidden identity preamble the models themselves run under).
   *
   * Runs after `executeProviderRequest`, whose billability gate and pricing
   * key on the concrete pool model: tokens and cost are already settled here,
   * only the label changes.
   */
  private applyAutoModelLabel(
    result: BlockOutput | StreamingExecution,
    resolvedModel: string
  ): void {
    const output = this.isStreamingExecution(result)
      ? (result as StreamingExecution).execution?.output
      : (result as BlockOutput)
    if (!output || typeof output !== 'object') return

    const target = output as {
      model?: string
      providerTiming?: {
        timeSegments?: Array<{ type?: string; name?: string; provider?: string }>
      }
    }
    target.model = SIM_AUTO_MODEL_ID

    // Model segments name themselves after the model (every provider does) and
    // carry the serving provider, which the log detail renders as that
    // provider's icon — the same leak by two other routes.
    for (const segment of target.providerTiming?.timeSegments ?? []) {
      if (segment.type !== 'model') continue
      if (segment.name?.toLowerCase() === resolvedModel.toLowerCase()) {
        segment.name = SIM_AUTO_MODEL_ID
      }
      segment.provider = undefined
    }
  }

  /**
   * Adds the billable sim-auto routing charge to the output's cost breakdown
   * as a distinct `routing` component.
   *
   * A non-streaming cost is final, so it is mutated in place. A streaming
   * output's cost settles at stream end — written through the accessor
   * `installStreamingCostPolicy` installed — so the charge is layered as a
   * read-time overlay on the property instead: whatever the drain writes,
   * every later read (trace spans, cost summary, usage ledger) sees the
   * routing component on top.
   */
  private applyRoutingCost(result: BlockOutput | StreamingExecution, routingCost: number): void {
    const output = this.isStreamingExecution(result)
      ? (result as StreamingExecution).execution?.output
      : (result as BlockOutput)
    if (!output || typeof output !== 'object') return
    const target = output as { cost?: Record<string, number> }

    const withRouting = (cost: Record<string, number> | undefined): Record<string, number> =>
      cost && typeof cost.total === 'number'
        ? { ...cost, routing: routingCost, total: cost.total + routingCost }
        : { input: 0, output: 0, routing: routingCost, total: routingCost }

    if (!this.isStreamingExecution(result)) {
      target.cost = withRouting(target.cost)
      return
    }

    const prior = Object.getOwnPropertyDescriptor(target, 'cost')
    let raw = prior?.get ? undefined : (target.cost as Record<string, number> | undefined)
    Object.defineProperty(target, 'cost', {
      get: () => withRouting(prior?.get ? (prior.get.call(target) as never) : raw),
      set: (value: Record<string, number> | undefined) => {
        if (prior?.set) prior.set.call(target, value)
        else raw = value
      },
      configurable: true,
      enumerable: true,
    })
  }

  private async validateToolPermissions(ctx: ExecutionContext, tools: ToolInput[]): Promise<void> {
    if (!Array.isArray(tools) || tools.length === 0) return

    const hasMcpTools = tools.some(
      (t) => t.type === 'mcp' || t.type === MCP_SERVER_ADVANCED_TOOL_TYPE
    )
    const hasCustomTools = tools.some((t) => t.type === 'custom-tool')

    if (hasMcpTools) {
      await assertPermissionsAllowed({
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
        toolKind: 'mcp',
        ctx,
      })
    }

    if (hasCustomTools) {
      await assertPermissionsAllowed({
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
        toolKind: 'custom',
        ctx,
      })
    }
  }

  private async filterUnavailableMcpTools(
    ctx: ExecutionContext,
    tools: ToolInput[]
  ): Promise<ToolInput[]> {
    if (!Array.isArray(tools) || tools.length === 0) return tools

    const mcpTools = tools.filter((t) => t.type === 'mcp')
    if (mcpTools.length === 0) return tools

    const serverIds = [...new Set(mcpTools.map((t) => t.params?.serverId).filter(Boolean))]
    if (serverIds.length === 0) return tools

    if (!ctx.workspaceId) {
      logger.warn('Skipping MCP availability filtering without workspace scope')
      return tools
    }

    const availableServerIds = new Set<string>()
    const sharedServerIds: string[] = []
    for (const serverId of serverIds) {
      if (serverId.startsWith(MANAGED_MCP_CONNECTION_PREFIX)) {
        if (!isManagedMcpConnectionId(serverId)) {
          throw new Error('Invalid managed MCP connection ID')
        }
        availableServerIds.add(serverId)
      } else {
        sharedServerIds.push(serverId)
      }
    }
    if (sharedServerIds.length > 0) {
      try {
        const servers = await db
          .select({
            id: mcpServers.id,
            connectionStatus: mcpServers.connectionStatus,
            credentialGroupId: mcpServers.credentialGroupId,
            enabled: mcpServers.enabled,
          })
          .from(mcpServers)
          .where(
            and(
              eq(mcpServers.workspaceId, ctx.workspaceId),
              inArray(mcpServers.id, sharedServerIds),
              isNull(mcpServers.deletedAt)
            )
          )

        for (const server of servers) {
          if (
            server.enabled &&
            !server.credentialGroupId &&
            server.connectionStatus === 'connected'
          ) {
            availableServerIds.add(server.id)
          }
        }
      } catch (error) {
        logger.warn(
          'Failed to check MCP server availability, including all tools',
          projectAgentDiagnosticMetadata(
            ctx,
            getErrorDiagnosticMetadata(error),
            getErrorDiagnosticFallback(error)
          )
        )
        for (const serverId of sharedServerIds) {
          availableServerIds.add(serverId)
        }
      }
    }

    return tools.filter((tool) => {
      if (tool.type !== 'mcp') return true
      const serverId = tool.params?.serverId
      if (!serverId) return false
      return availableServerIds.has(serverId)
    })
  }

  /**
   * `canonicalModes` overrides are keyed by each tool's position in the ORIGINAL, unfiltered
   * tools array (matching what the editor wrote), not by `tool.type` - so two tool entries of
   * the same type (e.g. two Table tools) resolve independently. `toolIndexByRef` preserves that
   * original position across the mcp-availability filter and the mcp/other split below, both of
   * which would otherwise renumber tools by their post-filter position.
   */
  private projectToolInputsForProvenance(
    ctx: ExecutionContext,
    inputTools: ToolInput[]
  ): ToolInput[] | undefined {
    const registry = ctx.resolvedSecretTraceRegistry
    if (!registry?.hasResolvedInputProjections() || inputTools.length === 0) return undefined

    const projection = registry.projectResolvedInputSelection({ tools: inputTools })
    if (!projection.complete || !Array.isArray(projection.value.tools)) {
      refuseResolvedSecretProjection({
        site: 'agent.toolInputProvenanceProjection',
        message: AGENT_TOOL_INPUT_REFUSAL,
        registry,
        inputPath: 'tools',
      })
    }
    return projection.value.tools as ToolInput[]
  }

  private async formatTools(
    ctx: ExecutionContext,
    inputTools: ToolInput[],
    canonicalModes?: Record<string, 'basic' | 'advanced'>,
    toolIndexByRef?: Map<ToolInput, number>,
    projectedToolInputs?: ToolInput[]
  ): Promise<FormattedAgentTools> {
    if (!Array.isArray(inputTools)) {
      return { tools: [], inputProvenance: new Map() }
    }

    const filtered = inputTools
      .map((tool, localIndex) => ({ tool, toolIndex: toolIndexByRef?.get(tool) ?? localIndex }))
      .filter(({ tool }) => (tool.usageControl || 'auto') !== 'none')

    this.assertInputPathsDoNotResolveSecrets(
      ctx,
      filtered.flatMap(({ tool, toolIndex }) => {
        const root = ['tools', String(toolIndex)] as const
        const paths: ResolvedSecretInputPath[] = [[...root, 'type']]
        if (tool.operation !== undefined) paths.push([...root, 'operation'])
        if (tool.type === 'mcp' || tool.type === MCP_SERVER_ADVANCED_TOOL_TYPE) {
          paths.push([...root, 'params', 'serverId'])
        }
        if (tool.type === 'mcp') {
          paths.push([...root, 'params', 'toolName'])
        }
        if (tool.type === 'custom-tool' && !tool.customToolId) {
          paths.push([...root, 'title'], [...root, 'schema', 'function', 'name'])
        }
        return paths
      }),
      'Agent structural model inputs cannot contain secret references'
    )

    const mcpTools: IndexedToolInput[] = []
    const advancedMcpServers: IndexedToolInput[] = []
    const otherTools: IndexedToolInput[] = []
    const inputProvenance = new Map<
      ProviderToolConfig,
      Omit<ProviderToolInputProvenance, 'registry'>
    >()

    const trackInputProvenance = (
      formattedTool: ProviderToolConfig | null,
      entry: IndexedToolInput
    ): ProviderToolConfig | null => {
      if (!formattedTool) return null
      const sourcePath = ['tools', String(entry.toolIndex), 'params']
      const sourceProvenance =
        ctx.resolvedSecretTraceRegistry?.exportCommittedProvenanceForInputPaths([sourcePath])
      if (sourceProvenance && !sourceProvenance.complete) {
        return null
      }
      if (!sourceProvenance || sourceProvenance.entries.length === 0) {
        return formattedTool
      }
      const projectedInput = projectedToolInputs?.[entry.toolIndex]
      inputProvenance.set(formattedTool, {
        sourcePath,
        projectedParams: this.getProjectedProviderToolParams(
          entry.tool,
          projectedInput,
          formattedTool
        ),
      })
      return formattedTool
    }

    assertValidMcpServerToolBindings(filtered.map(({ tool }) => tool))
    for (const entry of filtered) {
      if (entry.tool.type === 'mcp') {
        mcpTools.push(entry)
      } else if (entry.tool.type === MCP_SERVER_ADVANCED_TOOL_TYPE) {
        advancedMcpServers.push(entry)
      } else {
        otherTools.push(entry)
      }
    }

    const otherResults = await Promise.all(
      otherTools.map(async ({ tool, toolIndex }) => {
        try {
          if (tool.type && tool.type !== 'custom-tool') {
            await validateBlockType(ctx.userId, ctx.workspaceId, tool.type, ctx)
          }
          if (tool.type === 'custom-tool' && (tool.schema || tool.customToolId)) {
            return trackInputProvenance(
              await this.createCustomTool(ctx, tool, projectedToolInputs?.[toolIndex], toolIndex),
              {
                tool,
                toolIndex,
              }
            )
          }
          return trackInputProvenance(
            await this.transformBlockTool(ctx, tool, canonicalModes, toolIndex),
            { tool, toolIndex }
          )
        } catch (error) {
          if (
            error instanceof ToolSchemaEnrichmentError ||
            error instanceof AgentToolInputSafetyError
          ) {
            throw error
          }
          logger.error(
            '[AgentHandler] Error creating tool',
            projectAgentDiagnosticMetadata(
              ctx,
              { ...getToolDiagnosticMetadata(tool), ...getErrorDiagnosticMetadata(error) },
              { ...getToolDiagnosticFallback(tool), ...getErrorDiagnosticFallback(error) }
            )
          )
          return null
        }
      })
    )

    const mcpResults = await this.processMcpToolsBatched(
      ctx,
      mcpTools,
      trackInputProvenance,
      projectedToolInputs
    )
    const advancedMcpResults = await this.processAdvancedMcpServers(
      ctx,
      advancedMcpServers,
      trackInputProvenance
    )

    const allTools = [...otherResults, ...mcpResults, ...advancedMcpResults]
    const tools = allTools.filter(
      (tool): tool is ProviderToolConfig => tool !== null && tool !== undefined
    )
    await annotateDuplicateToolBindings(ctx, tools)
    return { tools, inputProvenance }
  }

  private assertInputPathsDoNotResolveSecrets(
    ctx: ExecutionContext,
    inputPaths: readonly ResolvedSecretInputPath[],
    errorMessage: string
  ): void {
    const registry = ctx.resolvedSecretTraceRegistry
    if (!registry) return

    const provenance = registry.exportCommittedProvenanceForInputPaths(inputPaths)
    if (!provenance.complete) {
      refuseResolvedSecretProjection({
        site: 'agent.structuralInputProvenance',
        message: AGENT_TOOL_INPUT_REFUSAL,
        registry,
        createError: toAgentToolInputSafetyError,
      })
    }
    if (provenance.entries.length > 0) {
      throw new AgentToolInputSafetyError(errorMessage)
    }
  }

  private getProjectedProviderToolParams(
    tool: ToolInput,
    projectedTool: ToolInput | undefined,
    formattedTool: ProviderToolConfig
  ): Record<string, unknown> {
    const projectedParams = projectedTool?.params ?? tool.params ?? {}
    const formattedParams = formattedTool.params ?? {}

    if (isCustomBlockType(tool.type)) {
      // Same sub-blocks the raw copy was assembled with, so both sides decode alike and
      // the projection keeps the shape the provenance registry compares.
      return {
        ...formattedParams,
        inputMapping: assembleCustomBlockInputMapping(
          projectedParams,
          formattedTool.customBlockInputFields
        ),
      }
    }

    const alignedParams = Object.fromEntries(
      Object.keys(formattedParams).map((key) => [
        key,
        Object.hasOwn(projectedParams, key) ? projectedParams[key] : formattedParams[key],
      ])
    )
    // An MCP tool has no block, so its only structured keys are the ones its own
    // `paramsTransform` decodes. A custom tool has neither.
    const blockInputs =
      tool.type &&
      tool.type !== 'mcp' &&
      tool.type !== MCP_SERVER_ADVANCED_TOOL_TYPE &&
      tool.type !== 'custom-tool'
        ? getBlock(tool.type)?.inputs
        : undefined
    return prepareResolvedSecretProjectedInputs(alignedParams, blockInputs, formattedParams, {
      additionalStructuredKeys: formattedTool.jsonShapedParamKeys,
    })
  }

  private async createCustomTool(
    ctx: ExecutionContext,
    tool: ToolInput,
    projectedTool?: ToolInput,
    toolIndex?: number
  ): Promise<any> {
    const userProvidedParams = tool.params || {}

    let schema = tool.schema
    let modelSchema = projectedTool?.schema ?? schema
    let title = tool.title
    let usesInlineDefinition = true

    if (tool.customToolId) {
      const resolved = await this.fetchCustomToolById(ctx, tool.customToolId)
      if (resolved) {
        schema = resolved.schema
        modelSchema = resolved.schema
        title = resolved.title
        usesInlineDefinition = false
      } else if (!schema) {
        logger.error(
          'Custom tool not found',
          projectAgentDiagnosticMetadata(
            ctx,
            getToolDiagnosticMetadata(tool),
            getToolDiagnosticFallback(tool)
          )
        )
        return null
      }
    }

    if (usesInlineDefinition && toolIndex !== undefined) {
      const functionRoot = ['tools', String(toolIndex), 'schema', 'function'] as const
      const schemaPaths = selectModelSchemaInputPaths(tool.schema?.function?.parameters, [
        ...functionRoot,
        'parameters',
      ])
      this.assertInputPathsDoNotResolveSecrets(
        ctx,
        [
          ['tools', String(toolIndex), 'title'],
          [...functionRoot, 'name'],
          ...schemaPaths.semanticInputPaths,
        ],
        'Agent structural model inputs cannot contain secret references'
      )
    }

    if (!schema?.function) {
      logger.error(
        'Custom tool missing schema',
        projectAgentDiagnosticMetadata(
          ctx,
          { customToolId: tool.customToolId, title },
          { hasCustomToolId: typeof tool.customToolId === 'string', hasTitle: Boolean(title) }
        )
      )
      return null
    }
    if (!modelSchema?.function) {
      refuseResolvedSecretProjection({
        site: 'agent.customToolModelSchemaMissing',
        message: AGENT_TOOL_INPUT_REFUSAL,
        registry: ctx.resolvedSecretTraceRegistry,
        inputPath: 'tools',
        createError: toAgentToolInputSafetyError,
      })
    }
    const parametersProjection = projectModelSchemaAnnotations(
      schema.function.parameters,
      modelSchema.function.parameters
    )
    if (!parametersProjection.safe) {
      refuseResolvedSecretProjection({
        site: 'agent.customToolSchemaAnnotations',
        message: AGENT_TOOL_INPUT_REFUSAL,
        registry: ctx.resolvedSecretTraceRegistry,
        inputPath: 'tools',
        createError: toAgentToolInputSafetyError,
      })
    }
    const rawDescription = schema.function.description
    const projectedDescription = modelSchema.function.description
    if (
      (rawDescription === undefined && projectedDescription !== undefined) ||
      (rawDescription !== undefined && projectedDescription === undefined)
    ) {
      refuseResolvedSecretProjection({
        site: 'agent.customToolDescriptionArity',
        message: AGENT_TOOL_INPUT_REFUSAL,
        registry: ctx.resolvedSecretTraceRegistry,
        inputPath: 'tools',
        createError: toAgentToolInputSafetyError,
      })
    }

    const modelParameters = parametersProjection.value as ToolSchema
    const filteredSchema = filterSchemaForLLM(modelParameters, userProvidedParams)

    const toolId = `${AGENT.CUSTOM_TOOL_PREFIX}${title}`
    const base: any = {
      id: toolId,
      description: projectedDescription || '',
      params: userProvidedParams,
      parameters: {
        ...filteredSchema,
        type: modelParameters.type,
      },
      usageControl: tool.usageControl || 'auto',
    }

    return base
  }

  /**
   * Fetches a custom tool definition from the database by ID
   */
  private async fetchCustomToolById(
    ctx: ExecutionContext,
    customToolId: string
  ): Promise<{ schema: any; title: string } | null> {
    if (!ctx.userId && !ctx.executorDelegationOrigin?.subjectUserId) {
      logger.error(
        'Cannot fetch custom tool without userId',
        projectAgentDiagnosticMetadata(
          ctx,
          { customToolId },
          { hasCustomToolId: customToolId.length > 0 }
        )
      )
      return null
    }

    try {
      const tool = await readAvailableCustomToolByIdOrTitleAsExecutor({
        context: ctx,
        identifier: customToolId,
        lookup: 'id',
      })

      if (!tool) {
        logger.warn(
          'Custom tool not found by ID',
          projectAgentDiagnosticMetadata(
            ctx,
            { customToolId },
            { hasCustomToolId: customToolId.length > 0 }
          )
        )
        return null
      }

      return {
        schema: tool.schema,
        title: tool.title,
      }
    } catch (error) {
      logger.error(
        'Error fetching custom tool',
        projectAgentDiagnosticMetadata(
          ctx,
          { customToolId, ...getErrorDiagnosticMetadata(error) },
          { hasCustomToolId: customToolId.length > 0, ...getErrorDiagnosticFallback(error) }
        )
      )
      return null
    }
  }

  /**
   * Process MCP tools using cached schemas from build time.
   * Note: Unavailable tools are already filtered by filterUnavailableMcpTools.
   */
  private async processMcpToolsBatched(
    ctx: ExecutionContext,
    mcpTools: IndexedToolInput[],
    trackInputProvenance: (
      formattedTool: ProviderToolConfig | null,
      entry: IndexedToolInput
    ) => ProviderToolConfig | null,
    projectedToolInputs?: ToolInput[]
  ): Promise<Array<ProviderToolConfig | null>> {
    if (mcpTools.length === 0) return []

    const results: Array<ProviderToolConfig | null> = []
    const toolsWithSchema: IndexedToolInput[] = []
    const toolsNeedingDiscovery: IndexedToolInput[] = []

    for (const entry of mcpTools) {
      const { tool } = entry
      const serverId = tool.params?.serverId
      const toolName = tool.params?.toolName

      if (!serverId || !toolName) {
        logger.error(
          'MCP tool missing serverId or toolName',
          projectAgentDiagnosticMetadata(
            ctx,
            getToolDiagnosticMetadata(tool),
            getToolDiagnosticFallback(tool)
          )
        )
        continue
      }

      if (tool.schema) {
        toolsWithSchema.push(entry)
      } else {
        logger.warn(
          'MCP tool missing cached schema, will need discovery',
          projectAgentDiagnosticMetadata(
            ctx,
            getToolDiagnosticMetadata(tool),
            getToolDiagnosticFallback(tool)
          )
        )
        toolsNeedingDiscovery.push(entry)
      }
    }

    for (const entry of toolsWithSchema) {
      const { tool } = entry
      try {
        const created = await this.createMcpToolFromCachedSchema(
          ctx,
          tool,
          projectedToolInputs?.[entry.toolIndex],
          entry.toolIndex
        )
        if (created) results.push(trackInputProvenance(created, entry))
      } catch (error) {
        if (error instanceof AgentToolInputSafetyError) throw error
        logger.error(
          'Error creating MCP tool from cached schema',
          projectAgentDiagnosticMetadata(
            ctx,
            { ...getToolDiagnosticMetadata(tool), ...getErrorDiagnosticMetadata(error) },
            { ...getToolDiagnosticFallback(tool), ...getErrorDiagnosticFallback(error) }
          )
        )
      }
    }

    if (toolsNeedingDiscovery.length > 0) {
      const discoveredResults = await this.processMcpToolsWithDiscovery(
        ctx,
        toolsNeedingDiscovery,
        trackInputProvenance
      )
      results.push(...discoveredResults)
    }

    return results
  }

  private async processAdvancedMcpServers(
    ctx: ExecutionContext,
    entries: IndexedToolInput[],
    trackInputProvenance: (
      formattedTool: ProviderToolConfig | null,
      entry: IndexedToolInput
    ) => ProviderToolConfig | null
  ): Promise<Array<ProviderToolConfig | null>> {
    const results = await Promise.all(
      entries.map(async (entry) => {
        const serverId = entry.tool.params?.serverId
        if (!serverId) throw new Error('MCP Server (Advanced) requires params.serverId')
        const tools = await this.discoverMcpToolsForServer(ctx, serverId)
        return Promise.all(
          tools.map(async (tool) => {
            const created = await this.buildMcpTool({
              serverId,
              toolName: tool.name,
              description: tool.description || `MCP tool ${tool.name} from ${tool.serverName}`,
              schema: tool.inputSchema || { type: 'object', properties: {} },
              userProvidedParams: {},
              usageControl: entry.tool.usageControl,
            })
            return trackInputProvenance(created, entry)
          })
        )
      })
    )
    return results.flat()
  }

  /**
   * Create MCP tool from cached schema. No MCP server connection required.
   */
  private async createMcpToolFromCachedSchema(
    ctx: ExecutionContext,
    tool: ToolInput,
    projectedTool?: ToolInput,
    toolIndex?: number
  ): Promise<any> {
    const { serverId, toolName, serverName, ...userProvidedParams } = tool.params || {}
    const projectedSchema = projectedTool?.schema ?? tool.schema
    if (projectedSchema !== undefined && !isPlainRecord(projectedSchema)) {
      refuseResolvedSecretProjection({
        site: 'agent.mcpToolSchemaShape',
        message: AGENT_TOOL_INPUT_REFUSAL,
        registry: ctx.resolvedSecretTraceRegistry,
        inputPath: 'tools',
        createError: toAgentToolInputSafetyError,
      })
    }
    const schemaProjection = projectModelSchemaAnnotations(tool.schema, projectedSchema)
    if (!schemaProjection.safe || !isPlainRecord(schemaProjection.value)) {
      refuseResolvedSecretProjection({
        site: 'agent.mcpToolSchemaAnnotations',
        message: AGENT_TOOL_INPUT_REFUSAL,
        registry: ctx.resolvedSecretTraceRegistry,
        inputPath: 'tools',
        createError: toAgentToolInputSafetyError,
      })
    }
    const projectedServerName =
      typeof projectedTool?.params?.serverName === 'string'
        ? projectedTool.params.serverName
        : serverName
    if (schemaProjection.value.type !== 'object') {
      refuseResolvedSecretProjection({
        site: 'agent.mcpToolSchemaType',
        message: AGENT_TOOL_INPUT_REFUSAL,
        registry: ctx.resolvedSecretTraceRegistry,
        inputPath: 'tools',
        createError: toAgentToolInputSafetyError,
      })
    }
    const schema: McpToolSchema = { ...schemaProjection.value, type: 'object' }
    const schemaDescription =
      typeof schema.description === 'string' ? schema.description : undefined
    if (toolIndex !== undefined) {
      const schemaPaths = selectModelSchemaInputPaths(tool.schema, [
        'tools',
        String(toolIndex),
        'schema',
      ])
      this.assertInputPathsDoNotResolveSecrets(
        ctx,
        schemaPaths.semanticInputPaths,
        'Agent structural model inputs cannot contain secret references'
      )
    }
    return this.buildMcpTool({
      serverId,
      toolName,
      description:
        schemaDescription || `MCP tool ${toolName} from ${projectedServerName || serverId}`,
      schema,
      userProvidedParams,
      usageControl: tool.usageControl,
    })
  }

  /**
   * Fallback for legacy tools without cached schemas. Groups by server to minimize connections.
   */
  private async processMcpToolsWithDiscovery(
    ctx: ExecutionContext,
    mcpTools: IndexedToolInput[],
    trackInputProvenance: (
      formattedTool: ProviderToolConfig | null,
      entry: IndexedToolInput
    ) => ProviderToolConfig | null
  ): Promise<Array<ProviderToolConfig | null>> {
    const toolsByServer = new Map<string, IndexedToolInput[]>()
    for (const entry of mcpTools) {
      const { tool } = entry
      const serverId = tool.params?.serverId
      if (!toolsByServer.has(serverId)) {
        toolsByServer.set(serverId, [])
      }
      toolsByServer.get(serverId)!.push(entry)
    }

    const serverDiscoveryResults = await Promise.all(
      Array.from(toolsByServer.entries()).map(async ([serverId, tools]) => {
        try {
          const discoveredTools = await this.discoverMcpToolsForServer(ctx, serverId)
          return { serverId, tools, discoveredTools, error: null as Error | null }
        } catch (error) {
          logger.error(
            'Failed to discover tools from MCP server',
            projectAgentDiagnosticMetadata(
              ctx,
              { serverId, ...getErrorDiagnosticMetadata(error) },
              { hasServerId: serverId.length > 0, ...getErrorDiagnosticFallback(error) }
            )
          )
          return { serverId, tools, discoveredTools: [] as any[], error: error as Error }
        }
      })
    )

    const results: Array<ProviderToolConfig | null> = []
    for (const { serverId, tools, discoveredTools, error } of serverDiscoveryResults) {
      if (error) continue

      for (const entry of tools) {
        const { tool } = entry
        try {
          const toolName = tool.params?.toolName
          const mcpTool = discoveredTools.find((t: any) => t.name === toolName)

          if (!mcpTool) {
            logger.error(
              'MCP tool not found on server',
              projectAgentDiagnosticMetadata(
                ctx,
                { toolName, serverId },
                { hasToolName: Boolean(toolName), hasServerId: serverId.length > 0 }
              )
            )
            continue
          }

          const created = await this.createMcpToolFromDiscoveredData(ctx, tool, mcpTool, serverId)
          if (created) results.push(trackInputProvenance(created, entry))
        } catch (error) {
          logger.error(
            'Error creating MCP tool',
            projectAgentDiagnosticMetadata(
              ctx,
              { ...getToolDiagnosticMetadata(tool), ...getErrorDiagnosticMetadata(error) },
              { ...getToolDiagnosticFallback(tool), ...getErrorDiagnosticFallback(error) }
            )
          )
        }
      }
    }

    return results
  }

  /** Discovers one server's tools through the authorized MCP operation. */
  private async discoverMcpToolsForServer(ctx: ExecutionContext, serverId: string): Promise<any[]> {
    if (!ctx.workspaceId) {
      throw new Error('workspaceId is required for MCP tool discovery')
    }
    if (!ctx.workflowId) {
      throw new Error('workflowId is required for MCP tool discovery')
    }

    return discoverMcpServerToolsAsExecutor({
      workspaceId: ctx.workspaceId,
      context: {
        workflowId: ctx.workflowId,
        workspaceId: ctx.workspaceId,
        executionId: ctx.executionId,
        userId: ctx.userId,
        executorDelegationOrigin: ctx.executorDelegationOrigin,
      },
      serverId,
      signal: ctx.abortSignal,
    })
  }

  private async createMcpToolFromDiscoveredData(
    ctx: ExecutionContext,
    tool: ToolInput,
    mcpTool: any,
    serverId: string
  ): Promise<any> {
    const { toolName, ...userProvidedParams } = tool.params || {}
    return this.buildMcpTool({
      serverId,
      toolName,
      description: mcpTool.description || `MCP tool ${toolName} from ${mcpTool.serverName}`,
      schema: mcpTool.inputSchema || { type: 'object', properties: {} },
      userProvidedParams,
      usageControl: tool.usageControl,
    })
  }

  private async buildMcpTool(config: {
    serverId: string
    toolName: string
    description: string
    schema: McpToolSchema
    userProvidedParams: Record<string, unknown>
    usageControl?: 'auto' | 'force' | 'none'
  }): Promise<ProviderToolConfig> {
    const filteredSchema = filterSchemaForLLM(config.schema, config.userProvidedParams)
    const toolId = createMcpToolId(config.serverId, config.toolName)

    // An MCP tool row renders its arguments through the same sub-block controls a block
    // tool uses, so its stored values are stringified the same way and need the same
    // decode. The shapes come from the tool's own JSON Schema, which is what chose the
    // controls in the first place.
    const paramShapes = buildJsonSchemaParamShapes(config.schema)
    const jsonShapedParamKeys = [...paramShapes]
      .filter(([, shape]) => shape === 'json')
      .map(([paramId]) => paramId)

    return {
      id: toolId,
      description: config.description,
      parameters: {
        type: filteredSchema.type,
        properties: filteredSchema.properties ?? {},
        required: filteredSchema.required ?? [],
      },
      params: config.userProvidedParams,
      usageControl: config.usageControl || 'auto',
      paramsTransform: (params: Record<string, unknown>) => decodeToolParams(params, paramShapes),
      ...(jsonShapedParamKeys.length > 0 && { jsonShapedParamKeys }),
    }
  }

  private async transformBlockTool(
    ctx: ExecutionContext,
    tool: ToolInput,
    canonicalModes?: Record<string, 'basic' | 'advanced'>,
    toolIndex?: number
  ) {
    const transformedTool = await transformBlockTool(tool, {
      selectedOperation: tool.operation,
      getAllBlocks,
      getToolAsync: (toolId: string) =>
        getToolAsync(toolId, {
          executionContext: ctx,
        }),
      getTool,
      canonicalModes,
      enrichmentContext: {
        workflowId: ctx.workflowId,
        workspaceId: ctx.workspaceId,
        executionId: ctx.executionId,
        userId: ctx.userId,
        executorDelegationOrigin: ctx.executorDelegationOrigin,
      },
      toolIndex,
      resolveCustomBlockBinding: (blockType: string) =>
        resolveCustomBlockToolBinding(blockType, ctx.workspaceId),
      readWorkflowInputFields: readWorkflowInputFieldsForTool,
      readWorkflowMetadata: readWorkflowMetadataForTool,
    })

    if (transformedTool) {
      transformedTool.usageControl = tool.usageControl || 'auto'
    }
    return transformedTool
  }

  private getStreamingConfig(ctx: ExecutionContext, block: SerializedBlock): StreamingConfig {
    const isBlockSelectedForOutput =
      ctx.selectedOutputs?.some((outputId) => {
        if (outputId === block.id) return true
        const firstUnderscoreIndex = outputId.indexOf('_')
        return (
          firstUnderscoreIndex !== -1 && outputId.substring(0, firstUnderscoreIndex) === block.id
        )
      }) ?? false

    const hasOutgoingConnections = ctx.edges?.some((edge) => edge.source === block.id) ?? false
    const shouldUseStreaming = Boolean(ctx.stream) && isBlockSelectedForOutput

    return { shouldUseStreaming, isBlockSelectedForOutput, hasOutgoingConnections }
  }

  private async buildMessages(
    ctx: ExecutionContext,
    inputs: AgentInputs,
    modelInputs: AgentInputs,
    skillMetadata: Array<{ name: string; description: string }> = []
  ): Promise<Message[] | undefined> {
    const messages: Message[] = []
    const memoryEnabled = inputs.memoryType && inputs.memoryType !== 'none'

    // 1. Extract and validate messages from messages-input subblock
    const inputMessages = this.extractValidMessages(inputs.messages)
    const projectedInputMessages = this.extractValidMessages(modelInputs.messages)
    const systemMessages = projectedInputMessages.filter((m) => m.role === 'system')
    const conversationMessages = projectedInputMessages.filter((m) => m.role !== 'system')
    const rawConversationMessages = inputMessages.filter((m) => m.role !== 'system')

    // 2. Handle native memory: seed on first run, then fetch and append new user input
    if (memoryEnabled && ctx.workspaceId) {
      const memoryMessages = await memoryService.fetchMemoryMessages(ctx, inputs)
      const hasExisting = memoryMessages.length > 0

      if (!hasExisting && conversationMessages.length > 0) {
        const taggedMessages = conversationMessages.map((m) =>
          m.role === 'user' ? { ...m, executionId: ctx.executionId } : m
        )
        const rawTaggedMessages = rawConversationMessages.map((m) =>
          m.role === 'user' ? { ...m, executionId: ctx.executionId } : m
        )
        await memoryService.seedMemory(ctx, inputs, rawTaggedMessages)
        messages.push(...taggedMessages)
      } else {
        messages.push(...memoryMessages)

        if (hasExisting && conversationMessages.length > 0) {
          const latestUserFromInput = conversationMessages.filter((m) => m.role === 'user').pop()
          const latestRawUserFromInput = rawConversationMessages
            .filter((m) => m.role === 'user')
            .pop()
          if (latestUserFromInput) {
            if (!latestRawUserFromInput) {
              refuseResolvedSecretProjection({
                site: 'agent.memoryUserMessageArity',
                message: AGENT_MODEL_INPUT_REFUSAL,
                registry: ctx.resolvedSecretTraceRegistry,
                inputPath: 'messages',
              })
            }
            const userMessageInThisRun = memoryMessages.some(
              (m) => m.role === 'user' && m.executionId === ctx.executionId
            )
            if (!userMessageInThisRun) {
              const taggedMessage = { ...latestUserFromInput, executionId: ctx.executionId }
              messages.push(taggedMessage)
              await memoryService.appendToMemory(ctx, inputs, {
                ...latestRawUserFromInput,
                executionId: ctx.executionId,
              })
            }
          }
        }
      }
    }

    // 3. Process legacy memories (backward compatibility - from Memory block)
    // These may include system messages which are preserved in their position
    if (inputs.memories) {
      messages.push(...this.processMemories(modelInputs.memories))
    }

    // 4. Add conversation messages from inputs.messages (if not using native memory)
    // When memory is enabled, these are already seeded/fetched above
    if (!memoryEnabled && conversationMessages.length > 0) {
      messages.push(...conversationMessages)
    }

    // 5. Handle legacy systemPrompt (backward compatibility)
    // Only add if no system message exists from any source
    if (inputs.systemPrompt) {
      const hasSystem = systemMessages.length > 0 || messages.some((m) => m.role === 'system')
      if (!hasSystem) {
        this.addSystemPrompt(messages, modelInputs.systemPrompt)
      }
    }

    // 6. Handle legacy userPrompt - this is NEW input each run
    if (inputs.userPrompt) {
      this.addUserPrompt(messages, modelInputs.userPrompt)

      if (memoryEnabled) {
        const userMessages = messages.filter((m) => m.role === 'user')
        const lastUserMessage = userMessages[userMessages.length - 1]
        if (lastUserMessage) {
          await memoryService.appendToMemory(ctx, inputs, {
            ...lastUserMessage,
            content: this.formatUserPrompt(inputs.userPrompt),
          })
        }
      }
    }

    // 7. Prefix system messages from inputs.messages at the start (runtime only)
    // These are the agent's configured system prompts
    if (systemMessages.length > 0) {
      messages.unshift(...systemMessages)
    }

    // 8. Inject skill metadata into the system message (progressive disclosure)
    if (skillMetadata.length > 0) {
      const skillSection = buildSkillsSystemPromptSection(skillMetadata)
      const systemIdx = messages.findIndex((m) => m.role === 'system')
      if (systemIdx >= 0) {
        messages[systemIdx] = {
          ...messages[systemIdx],
          content: messages[systemIdx].content + skillSection,
        }
      } else {
        messages.unshift({ role: 'system', content: skillSection.trim() })
      }
    }

    return messages.length > 0 ? messages : undefined
  }

  private attachFilesToLastUserMessage(
    ctx: ExecutionContext,
    messages: Message[] | undefined,
    filesInput: unknown,
    projectedFilesInput: unknown,
    projectedNameByFile: WeakMap<object, { name: string; inputPath: ResolvedSecretInputPath }>,
    directNameInputPaths: readonly ResolvedSecretInputPath[]
  ): Message[] | undefined {
    const normalizedFiles = normalizeFileInput(filesInput)
    if (!normalizedFiles || normalizedFiles.length === 0) {
      return messages
    }
    const projectedFiles = normalizeFileInput(projectedFilesInput)
    if (!projectedFiles || projectedFiles.length !== normalizedFiles.length) {
      refuseResolvedSecretProjection({
        site: 'agent.fileInputArity',
        message: AGENT_MODEL_INPUT_REFUSAL,
        registry: ctx.resolvedSecretTraceRegistry,
        inputPath: 'files',
      })
    }

    if (!messages || messages.length === 0) {
      throw new Error('Files require at least one user message in the agent prompt')
    }

    let lastUserMessageIndex = -1
    for (let index = messages.length - 1; index >= 0; index--) {
      if (messages[index].role === 'user') {
        lastUserMessageIndex = index
        break
      }
    }
    if (lastUserMessageIndex === -1) {
      throw new Error('Files require at least one user message in the agent prompt')
    }

    const requestId = ctx.executionId || ctx.workflowId || 'agent-files'
    const userFiles = normalizedFiles.flatMap((file, index) => {
      const converted = processFilesToUserFiles([file] as RawFileInput[], requestId, logger)
      const userFile = converted[0]
      if (!userFile) return []

      const projectedFile = projectedFiles[index]
      if (!isPlainRecord(projectedFile) || typeof projectedFile.name !== 'string') {
        refuseResolvedSecretProjection({
          site: 'agent.fileInputShape',
          message: AGENT_MODEL_INPUT_REFUSAL,
          registry: ctx.resolvedSecretTraceRegistry,
          inputPath: 'files',
        })
      }
      const rawName = isPlainRecord(file) ? file.name : undefined
      if (typeof rawName === 'string' && projectedFile.name !== rawName) {
        projectedNameByFile.set(userFile, {
          name: projectedFile.name,
          inputPath: directNameInputPaths[index] ?? ['files', String(index), 'name'],
        })
      }
      return [userFile]
    })
    if (userFiles.length === 0) {
      throw new Error('Files must include at least one valid file object')
    }

    const lastUserMessage = messages[lastUserMessageIndex]
    const nextMessages = [...messages]
    nextMessages[lastUserMessageIndex] = {
      ...lastUserMessage,
      files: [...(lastUserMessage.files ?? []), ...userFiles],
    }

    return nextMessages
  }

  private async hydrateMessageFilesForProvider(
    ctx: ExecutionContext,
    messages: Message[] | undefined,
    providerId: string,
    projectedNameByFile: WeakMap<object, { name: string; inputPath: ResolvedSecretInputPath }>,
    modelBoundInputPaths: ResolvedSecretInputPath[]
  ): Promise<Message[] | undefined> {
    if (!messages?.some((message) => message.files?.length)) {
      return messages
    }

    if (!supportsFileAttachments(providerId)) {
      throw new Error(`File attachments are not supported for provider "${providerId}"`)
    }

    const requestId = ctx.executionId || ctx.workflowId || 'agent-files'
    const nextMessages = [...messages]

    const inlineMaxBytes = getInlineHydrationMaxBytes(providerId)

    for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
      const message = messages[messageIndex]
      if (!message.files?.length) {
        continue
      }

      const unsafeGeneratedDocumentFiles = new Set<string>()
      const hydratedFiles = await hydrateUserFilesWithBase64(message.files, {
        requestId,
        workspaceId: ctx.workspaceId,
        workflowId: ctx.workflowId,
        executionId: ctx.executionId,
        largeValueExecutionIds: ctx.largeValueExecutionIds,
        largeValueKeys: ctx.largeValueKeys,
        fileKeys: ctx.fileKeys,
        allowLargeValueWorkflowScope: ctx.allowLargeValueWorkflowScope,
        userId: ctx.userId,
        principal: ctx.principal,
        logger,
        maxBytes: inlineMaxBytes,
        onServableFileContributors: async (file, contributors) => {
          if (!ctx.workspaceId) return
          for (const identity of contributors) {
            const safe = await importWorkspaceFileSecretProvenanceForModelView({
              workspaceId: ctx.workspaceId,
              identity,
              registry: ctx.resolvedSecretTraceRegistry,
              view: 'opaque',
              ...(ctx.userId ? { actorUserId: ctx.userId } : {}),
            })
            if (!safe) {
              unsafeGeneratedDocumentFiles.add(`${file.key}:${file.id}`)
              return
            }
          }
        },
      })

      const modelSafeHydratedFiles = hydratedFiles.flatMap((file, fileIndex) => {
        if (unsafeGeneratedDocumentFiles.has(`${file.key}:${file.id}`)) return []

        const sourceFile = message.files?.[fileIndex]
        const nameProjection = sourceFile ? projectedNameByFile.get(sourceFile) : undefined
        if (
          !nameProjection ||
          !isProviderAttachmentFilenameModelBound(file, providerId, {
            largeFilePathAvailable: canUseProviderLargeFilePath(providerId),
          })
        ) {
          return [file]
        }

        modelBoundInputPaths.push(nameProjection.inputPath)
        const extension = getFileExtension(file.name)
        const suffix = extension ? `.${extension}` : ''
        const keepsSuffix =
          suffix !== '' && nameProjection.name.toLowerCase().endsWith(suffix.toLowerCase())
        return [
          {
            ...file,
            name:
              suffix !== '' && !keepsSuffix
                ? `${nameProjection.name}${suffix}`
                : nameProjection.name,
          },
        ]
      })
      if (modelSafeHydratedFiles.length !== hydratedFiles.length) {
        logger.warn('Omitting generated document attachments with unsafe contributor provenance', {
          omittedCount: hydratedFiles.length - modelSafeHydratedFiles.length,
          attachmentCount: hydratedFiles.length,
        })
      }

      const missingFile = modelSafeHydratedFiles.find(
        (file) =>
          !file.base64 &&
          !(canUseProviderLargeFilePath(providerId) && shouldUseLargeFilePath(file, providerId))
      )
      if (missingFile) {
        const { size: sizeMB, limit: inlineMB } = formatAttachmentSizes(
          missingFile.size,
          inlineMaxBytes
        )
        const oversized = Number.isFinite(missingFile.size) && missingFile.size > inlineMaxBytes
        /**
         * Ordered by how general the cause is. A provider with no upload path at all cannot be
         * helped by changing the file, and a deployment with no object storage cannot reach any
         * upload path whatever the file is — so both outrank the format-specific case. Leading
         * with the generated-document arm blamed the document on providers that have no upload
         * path for anything, and on hosts whose only real problem was unconfigured storage.
         */
        const reason =
          getProviderFileStrategy(providerId) === 'inline'
            ? `provider "${providerId}" has no large-file upload path`
            : !canUseProviderLargeFilePath(providerId)
              ? 'this deployment has no cloud file storage for the large-file upload path'
              : `a generated document cannot use the large-file path for provider "${providerId}", because a signed URL points at the generation source rather than the rendered file`
        throw new Error(
          oversized
            ? `File "${missingFile.name}" (${sizeMB}MB) exceeds the ${inlineMB}MB inline attachment limit, and ${reason}.`
            : `File "${missingFile.name}" could not be read for provider "${providerId}". The file may no longer be accessible.`
        )
      }

      nextMessages[messageIndex] = {
        ...message,
        files: modelSafeHydratedFiles,
      }
    }

    return nextMessages
  }

  private extractValidMessages(messages?: Message[]): Message[] {
    if (!messages || !Array.isArray(messages)) return []

    return messages.filter(
      (msg): msg is Message =>
        msg &&
        typeof msg === 'object' &&
        'role' in msg &&
        'content' in msg &&
        ['system', 'user', 'assistant'].includes(msg.role)
    )
  }

  private processMemories(memories: any): Message[] {
    if (!memories) return []

    let memoryArray: any[] = []
    if (memories?.memories && Array.isArray(memories.memories)) {
      memoryArray = memories.memories
    } else if (Array.isArray(memories)) {
      memoryArray = memories
    }

    const messages: Message[] = []
    memoryArray.forEach((memory: any) => {
      if (memory.data && Array.isArray(memory.data)) {
        memory.data.forEach((msg: any) => {
          if (msg.role && msg.content && ['system', 'user', 'assistant'].includes(msg.role)) {
            messages.push({
              role: msg.role as 'system' | 'user' | 'assistant',
              content: msg.content,
            })
          }
        })
      } else if (
        memory.role &&
        memory.content &&
        ['system', 'user', 'assistant'].includes(memory.role)
      ) {
        messages.push({
          role: memory.role as 'system' | 'user' | 'assistant',
          content: memory.content,
        })
      }
    })

    return messages
  }

  /**
   * Ensures system message is at position 0 (industry standard)
   * Preserves existing system message if already at position 0, otherwise adds/moves it
   */
  private addSystemPrompt(messages: Message[], systemPrompt: any) {
    let content: string

    if (typeof systemPrompt === 'string') {
      content = systemPrompt
    } else {
      try {
        content = JSON.stringify(systemPrompt, null, 2)
      } catch (error) {
        content = String(systemPrompt)
      }
    }

    const firstSystemIndex = messages.findIndex((msg) => msg.role === 'system')

    if (firstSystemIndex === -1) {
      messages.unshift({ role: 'system', content })
    } else if (firstSystemIndex === 0) {
      messages[0] = { role: 'system', content }
    } else {
      messages.splice(firstSystemIndex, 1)
      messages.unshift({ role: 'system', content })
    }

    for (let i = messages.length - 1; i >= 1; i--) {
      if (messages[i].role === 'system') {
        messages.splice(i, 1)
        logger.warn('Removed duplicate system message from conversation history', {
          position: i,
        })
      }
    }
  }

  private addUserPrompt(messages: Message[], userPrompt: any) {
    messages.push({ role: 'user', content: this.formatUserPrompt(userPrompt) })
  }

  private formatUserPrompt(userPrompt: any): string {
    if (typeof userPrompt === 'object' && userPrompt.input) {
      return String(userPrompt.input)
    }
    return typeof userPrompt === 'object' ? JSON.stringify(userPrompt) : String(userPrompt)
  }

  private getPrivateAgentSelectorInputPaths(
    ctx: ExecutionContext,
    inputs: AgentInputs,
    responseFormatNameInputPaths: readonly ResolvedSecretInputPath[]
  ): { complete: boolean; inputPaths: ResolvedSecretInputPath[] } {
    const registry = ctx.resolvedSecretTraceRegistry
    if (!registry) return { complete: true, inputPaths: [] }

    const candidatePaths: ResolvedSecretInputPath[] = [...responseFormatNameInputPaths]
    for (let toolIndex = 0; toolIndex < (inputs.tools?.length ?? 0); toolIndex++) {
      if (inputs.tools?.[toolIndex]?.customToolId) {
        candidatePaths.push(['tools', String(toolIndex), 'customToolId'])
      }
    }
    for (let skillIndex = 0; skillIndex < (inputs.skills?.length ?? 0); skillIndex++) {
      if (inputs.skills?.[skillIndex]?.skillId) {
        candidatePaths.push(['skills', String(skillIndex), 'skillId'])
      }
    }

    const privatePaths: ResolvedSecretInputPath[] = []
    let complete = true
    for (const path of candidatePaths) {
      const provenance = registry.exportCommittedProvenanceForInputPaths([path])
      if (!provenance.complete) {
        complete = false
        continue
      }
      if (provenance.entries.length > 0) privatePaths.push(path)
    }
    return { complete, inputPaths: privatePaths }
  }

  private settlePrivateAgentSelectors(
    ctx: ExecutionContext,
    inputs: AgentInputs,
    privateInputPaths: readonly ResolvedSecretInputPath[],
    responseFormatModelInputPaths: readonly ResolvedSecretInputPath[]
  ): void {
    const sourceRegistry = ctx.resolvedSecretTraceRegistry
    if (!sourceRegistry || privateInputPaths.length === 0) return

    const privateRoots = new Set(privateInputPaths.map((path) => path[0]))
    const displayInputPaths = privateRoots.has('responseFormat')
      ? [...privateInputPaths, ['responseFormat']]
      : privateInputPaths
    const displayRegistry = sourceRegistry.forkForInputPaths(displayInputPaths)
    const displayProjection = displayRegistry.projectResolvedInputSelection({
      responseFormat: inputs.responseFormat,
      tools: inputs.tools,
      skills: inputs.skills,
    })
    if (!displayProjection.complete) {
      refuseResolvedSecretProjection({
        site: 'agent.privateSelectorDisplayProjection',
        message: AGENT_PRIVATE_SELECTOR_REFUSAL,
        registry: displayRegistry,
        inputPath: 'responseFormat,tools,skills',
        createError: toAgentToolInputSafetyError,
      })
    }
    if (privateRoots.has('responseFormat')) {
      inputs.responseFormat = displayProjection.value
        .responseFormat as AgentInputs['responseFormat']
    }
    if (privateRoots.has('tools')) {
      if (!Array.isArray(displayProjection.value.tools)) {
        refuseResolvedSecretProjection({
          site: 'agent.privateSelectorToolsShape',
          message: AGENT_PRIVATE_SELECTOR_REFUSAL,
          registry: displayRegistry,
          inputPath: 'tools',
          createError: toAgentToolInputSafetyError,
        })
      }
      inputs.tools = displayProjection.value.tools as ToolInput[]
    }
    if (privateRoots.has('skills')) {
      if (!Array.isArray(displayProjection.value.skills)) {
        refuseResolvedSecretProjection({
          site: 'agent.privateSelectorSkillsShape',
          message: AGENT_PRIVATE_SELECTOR_REFUSAL,
          registry: displayRegistry,
          inputPath: 'skills',
          createError: toAgentToolInputSafetyError,
        })
      }
      inputs.skills = displayProjection.value.skills as AgentInputs['skills']
    }

    const excludedPaths = new Set(privateInputPaths.map((path) => JSON.stringify(path)))
    const retainedInputPaths: ResolvedSecretInputPath[] = []
    for (const [key, value] of Object.entries(inputs)) {
      if (!privateRoots.has(key)) {
        retainedInputPaths.push([key])
        continue
      }
      if (key === 'responseFormat') {
        retainedInputPaths.push(...responseFormatModelInputPaths)
        continue
      }
      if (!Array.isArray(value)) continue
      for (const [inputIndex, candidate] of value.entries()) {
        if (!isPlainRecord(candidate)) continue
        for (const candidateKey of Object.keys(candidate)) {
          const path = [key, String(inputIndex), candidateKey]
          if (!excludedPaths.has(JSON.stringify(path))) retainedInputPaths.push(path)
        }
      }
    }
    ctx.resolvedSecretTraceRegistry = sourceRegistry.forkForInputPaths(retainedInputPaths)
  }

  private projectResponseFormatForModel(
    ctx: ExecutionContext,
    inputs: AgentInputs,
    onPrivateNameInputPaths: (paths: readonly ResolvedSecretInputPath[]) => void
  ): {
    value: AgentInputs['responseFormat']
    inputPaths: ResolvedSecretInputPath[]
  } {
    const responseFormat = inputs.responseFormat
    if (responseFormat === undefined) {
      return { value: undefined, inputPaths: [] }
    }

    let annotationInputPaths: ResolvedSecretInputPath[] = []
    let structuralInputPaths: ResolvedSecretInputPath[] = []
    const isWrapper =
      isPlainRecord(responseFormat) &&
      (Object.hasOwn(responseFormat, 'schema') || Object.hasOwn(responseFormat, 'name'))

    if (isPlainRecord(responseFormat)) {
      const schema = isWrapper ? responseFormat.schema : responseFormat
      const schemaRoot = isWrapper ? ['responseFormat', 'schema'] : ['responseFormat']
      const schemaPaths = selectModelSchemaInputPaths(schema, schemaRoot)
      annotationInputPaths = schemaPaths.annotationInputPaths
      structuralInputPaths = schemaPaths.semanticInputPaths
      if (isWrapper) {
        structuralInputPaths.push(
          ...Object.keys(responseFormat)
            .filter((key) => key !== 'schema' && key !== 'name')
            .map((key) => ['responseFormat', key])
        )
      }
    }

    const registry = ctx.resolvedSecretTraceRegistry
    if (!registry) {
      this.assertInputPathsDoNotResolveSecrets(
        ctx,
        structuralInputPaths,
        'Agent structural model inputs cannot contain secret references'
      )
      return { value: responseFormat, inputPaths: annotationInputPaths }
    }
    const projection = registry.projectResolvedInputSelection({ responseFormat })
    if (!projection.complete) {
      refuseResolvedSecretProjection({
        site: 'agent.responseFormatProjection',
        message: AGENT_MODEL_INPUT_REFUSAL,
        registry,
        inputPath: 'responseFormat',
        createError: toAgentToolInputSafetyError,
      })
    }
    const projectedResponseFormat = projection.value.responseFormat

    if (typeof responseFormat === 'string') {
      if (Object.is(responseFormat, projectedResponseFormat)) {
        return { value: responseFormat, inputPaths: annotationInputPaths }
      }
      if (typeof projectedResponseFormat !== 'string') {
        refuseResolvedSecretProjection({
          site: 'agent.responseFormatStringType',
          message: AGENT_MODEL_INPUT_REFUSAL,
          registry,
          inputPath: 'responseFormat',
          createError: toAgentToolInputSafetyError,
        })
      }
      try {
        const rawParsed = JSON.parse(responseFormat)
        const projectedParsed = JSON.parse(projectedResponseFormat)
        if (!isPlainRecord(rawParsed) || !isPlainRecord(projectedParsed)) {
          refuseResolvedSecretProjection({
            site: 'agent.responseFormatJsonShape',
            message: AGENT_MODEL_INPUT_REFUSAL,
            registry,
            inputPath: 'responseFormat',
            createError: toAgentToolInputSafetyError,
          })
        }
        const privateNameInputPaths =
          Object.hasOwn(rawParsed, 'name') && !Object.is(rawParsed.name, projectedParsed.name)
            ? ([['responseFormat']] as const)
            : []
        onPrivateNameInputPaths(privateNameInputPaths)
        const modelSafeResponseFormat = this.projectResponseFormatObject(
          rawParsed,
          projectedParsed,
          registry
        )
        const parsedIsWrapper =
          Object.hasOwn(rawParsed, 'schema') || Object.hasOwn(rawParsed, 'name')
        const parsedSchema = parsedIsWrapper ? rawParsed.schema : rawParsed
        const parsedSchemaRoot = parsedIsWrapper ? ['responseFormat', 'schema'] : ['responseFormat']
        const parsedAnnotationInputPaths = selectModelSchemaInputPaths(
          parsedSchema,
          parsedSchemaRoot
        ).annotationInputPaths
        registry.recordTransformedInputProjection(
          { responseFormat: rawParsed },
          { responseFormat: projectedParsed },
          { targetPaths: parsedAnnotationInputPaths }
        )
        return {
          value: modelSafeResponseFormat,
          inputPaths: parsedAnnotationInputPaths,
        }
      } catch (error) {
        if (error instanceof AgentToolInputSafetyError) throw error
        refuseResolvedSecretProjection({
          site: 'agent.responseFormatJsonParse',
          message: AGENT_MODEL_INPUT_REFUSAL,
          registry,
          inputPath: 'responseFormat',
          createError: toAgentToolInputSafetyError,
        })
      }
    }

    if (!isPlainRecord(responseFormat)) {
      if (!Object.is(responseFormat, projectedResponseFormat)) {
        refuseResolvedSecretProjection({
          site: 'agent.responseFormatScalarIdentity',
          message: AGENT_MODEL_INPUT_REFUSAL,
          registry,
          inputPath: 'responseFormat',
          createError: toAgentToolInputSafetyError,
        })
      }
      return {
        value: responseFormat,
        inputPaths: annotationInputPaths,
      }
    }
    const privateNameInputPaths =
      Object.hasOwn(responseFormat, 'name') &&
      isPlainRecord(projectedResponseFormat) &&
      !Object.is(responseFormat.name, projectedResponseFormat.name)
        ? [['responseFormat', 'name']]
        : []
    onPrivateNameInputPaths(privateNameInputPaths)
    this.assertInputPathsDoNotResolveSecrets(
      ctx,
      structuralInputPaths,
      'Agent structural model inputs cannot contain secret references'
    )
    return {
      value: this.projectResponseFormatObject(responseFormat, projectedResponseFormat, registry),
      inputPaths: annotationInputPaths,
    }
  }

  /**
   * Takes the registry from its caller so a refusal here reports the run that failed; without it
   * the refusal would deduplicate process-wide and name no cause.
   */
  private projectResponseFormatObject(
    rawValue: Record<string, unknown>,
    projectedValue: unknown,
    registry: ResolvedSecretTraceRegistry
  ): Record<string, unknown> {
    if (!isPlainRecord(projectedValue)) {
      refuseResolvedSecretProjection({
        site: 'agent.responseFormatObjectShape',
        message: AGENT_MODEL_INPUT_REFUSAL,
        registry,
        inputPath: 'responseFormat',
        createError: toAgentToolInputSafetyError,
      })
    }
    const isWrapper = Object.hasOwn(rawValue, 'schema') || Object.hasOwn(rawValue, 'name')
    if (!isWrapper) {
      const schemaProjection = projectModelSchemaAnnotations(rawValue, projectedValue)
      if (!schemaProjection.safe || !isPlainRecord(schemaProjection.value)) {
        refuseResolvedSecretProjection({
          site: 'agent.responseFormatSchemaAnnotations',
          message: AGENT_MODEL_INPUT_REFUSAL,
          registry,
          inputPath: 'responseFormat',
          createError: toAgentToolInputSafetyError,
        })
      }
      return schemaProjection.value
    }

    const rawKeys = Object.keys(rawValue)
    if (
      rawKeys.length !== Object.keys(projectedValue).length ||
      rawKeys.some((key) => !Object.hasOwn(projectedValue, key))
    ) {
      refuseResolvedSecretProjection({
        site: 'agent.responseFormatWrapperKeys',
        message: AGENT_MODEL_INPUT_REFUSAL,
        registry,
        inputPath: 'responseFormat',
        createError: toAgentToolInputSafetyError,
      })
    }
    for (const key of rawKeys) {
      if (key !== 'schema' && key !== 'name' && !Object.is(rawValue[key], projectedValue[key])) {
        refuseResolvedSecretProjection({
          site: 'agent.responseFormatWrapperValues',
          message: AGENT_MODEL_INPUT_REFUSAL,
          registry,
          inputPath: 'responseFormat',
          createError: toAgentToolInputSafetyError,
        })
      }
    }
    const schemaProjection = projectModelSchemaAnnotations(rawValue.schema, projectedValue.schema)
    if (!schemaProjection.safe) {
      refuseResolvedSecretProjection({
        site: 'agent.responseFormatWrapperSchemaAnnotations',
        message: AGENT_MODEL_INPUT_REFUSAL,
        registry,
        inputPath: 'responseFormat',
        createError: toAgentToolInputSafetyError,
      })
    }
    return {
      ...rawValue,
      ...(Object.hasOwn(rawValue, 'name') && !Object.is(rawValue.name, projectedValue.name)
        ? { name: MODEL_SAFE_RESPONSE_FORMAT_NAME }
        : {}),
      ...(Object.hasOwn(rawValue, 'schema') ? { schema: schemaProjection.value } : {}),
    }
  }

  private getFileInputPaths(
    inputs: AgentInputs,
    field: 'base64' | 'name'
  ): ResolvedSecretInputPath[] {
    const paths = selectModelBoundFileInputPaths(inputs.files, ['files'], {
      includeInlineBase64: true,
      includeName: true,
    })
    for (let messageIndex = 0; messageIndex < (inputs.messages?.length ?? 0); messageIndex++) {
      paths.push(
        ...selectModelBoundFileInputPaths(
          inputs.messages?.[messageIndex]?.files,
          ['messages', String(messageIndex), 'files'],
          { includeInlineBase64: true, includeName: true }
        )
      )
    }
    return paths.filter((path) => path.at(-1) === field)
  }

  private projectFileNamesForModel(
    ctx: ExecutionContext,
    inputs: AgentInputs
  ): {
    projectedFiles: unknown
    projectedNameByFile: WeakMap<object, { name: string; inputPath: ResolvedSecretInputPath }>
    directNameInputPaths: ResolvedSecretInputPath[]
    modelBoundInputPaths: ResolvedSecretInputPath[]
  } {
    const inputPaths = this.getFileInputPaths(inputs, 'name')
    this.assertInputPathsDoNotResolveSecrets(
      ctx,
      this.getFileInputPaths(inputs, 'base64'),
      'Agent inline file content cannot contain secret references'
    )
    const projection = projectResolvedModelInput(
      ctx.resolvedSecretTraceRegistry,
      { files: inputs.files, messages: inputs.messages },
      inputPaths
    )
    if (!projection.complete) {
      refuseResolvedSecretProjection({
        site: 'agent.fileNameProjection',
        message: AGENT_MODEL_INPUT_REFUSAL,
        registry: ctx.resolvedSecretTraceRegistry,
        inputPath: 'files,messages',
        createError: toAgentToolInputSafetyError,
      })
    }

    let projectedFiles = projection.value.files
    let directNameInputPaths: ResolvedSecretInputPath[] = Array.isArray(inputs.files)
      ? inputs.files.map((_, index) => ['files', String(index), 'name'])
      : isPlainRecord(inputs.files)
        ? [['files', 'name']]
        : []

    if (typeof inputs.files === 'string' && ctx.resolvedSecretTraceRegistry) {
      const serializedProjection = ctx.resolvedSecretTraceRegistry.projectResolvedInputSelection({
        files: inputs.files,
      })
      if (!serializedProjection.complete) {
        refuseResolvedSecretProjection({
          site: 'agent.serializedFilesProjection',
          message: AGENT_MODEL_INPUT_REFUSAL,
          registry: ctx.resolvedSecretTraceRegistry,
          inputPath: 'files',
          createError: toAgentToolInputSafetyError,
        })
      }
      const projectedSerializedFiles = serializedProjection.value.files
      if (!Object.is(inputs.files, projectedSerializedFiles)) {
        if (typeof projectedSerializedFiles !== 'string') {
          refuseResolvedSecretProjection({
            site: 'agent.serializedFilesType',
            message: AGENT_MODEL_INPUT_REFUSAL,
            registry: ctx.resolvedSecretTraceRegistry,
            inputPath: 'files',
            createError: toAgentToolInputSafetyError,
          })
        }
        const rawFiles = normalizeFileInput(inputs.files)
        const projectedFileRecords = normalizeFileInput(projectedSerializedFiles)
        if (!rawFiles || !projectedFileRecords || rawFiles.length !== projectedFileRecords.length) {
          refuseResolvedSecretProjection({
            site: 'agent.serializedFilesArity',
            message: AGENT_MODEL_INPUT_REFUSAL,
            registry: ctx.resolvedSecretTraceRegistry,
            inputPath: 'files',
            createError: toAgentToolInputSafetyError,
          })
        }

        projectedFiles = rawFiles.map((rawFile, index) => {
          const projectedFile = projectedFileRecords[index]
          if (!isPlainRecord(rawFile) || !isPlainRecord(projectedFile)) {
            refuseResolvedSecretProjection({
              site: 'agent.serializedFileShape',
              message: AGENT_MODEL_INPUT_REFUSAL,
              registry: ctx.resolvedSecretTraceRegistry,
              inputPath: 'files',
              createError: toAgentToolInputSafetyError,
            })
          }
          if (!Object.is(rawFile.base64, projectedFile.base64)) {
            throw new AgentToolInputSafetyError(
              'Agent inline file content cannot contain secret references'
            )
          }
          if (rawFile.name === undefined) return rawFile
          if (typeof projectedFile.name !== 'string') {
            refuseResolvedSecretProjection({
              site: 'agent.serializedFileName',
              message: AGENT_MODEL_INPUT_REFUSAL,
              registry: ctx.resolvedSecretTraceRegistry,
              inputPath: 'files,name',
              createError: toAgentToolInputSafetyError,
            })
          }
          return { ...rawFile, name: projectedFile.name }
        })
        directNameInputPaths = rawFiles.map(() => ['files'])
      }
    }

    const projectedNameByFile = new WeakMap<
      object,
      { name: string; inputPath: ResolvedSecretInputPath }
    >()
    const projectedMessages = Array.isArray(projection.value.messages)
      ? projection.value.messages
      : []
    for (let messageIndex = 0; messageIndex < (inputs.messages?.length ?? 0); messageIndex++) {
      const rawFiles = inputs.messages?.[messageIndex]?.files
      const projectedMessage = projectedMessages[messageIndex]
      const projectedFiles = isPlainRecord(projectedMessage) ? projectedMessage.files : undefined
      if (!Array.isArray(rawFiles) || !Array.isArray(projectedFiles)) continue
      if (rawFiles.length !== projectedFiles.length) {
        refuseResolvedSecretProjection({
          site: 'agent.messageFilesArity',
          message: AGENT_MODEL_INPUT_REFUSAL,
          registry: ctx.resolvedSecretTraceRegistry,
          inputPath: 'messages,files',
          createError: toAgentToolInputSafetyError,
        })
      }
      for (let fileIndex = 0; fileIndex < rawFiles.length; fileIndex++) {
        const rawFile = rawFiles[fileIndex]
        const projectedFile = projectedFiles[fileIndex]
        if (!isPlainRecord(rawFile) || !isPlainRecord(projectedFile)) continue
        if (rawFile.name === undefined) continue
        if (typeof projectedFile.name !== 'string') {
          refuseResolvedSecretProjection({
            site: 'agent.messageFileName',
            message: AGENT_MODEL_INPUT_REFUSAL,
            registry: ctx.resolvedSecretTraceRegistry,
            inputPath: 'messages,files,name',
            createError: toAgentToolInputSafetyError,
          })
        }
        if (Object.is(rawFile.name, projectedFile.name)) continue
        projectedNameByFile.set(rawFile, {
          name: projectedFile.name,
          inputPath: ['messages', String(messageIndex), 'files', String(fileIndex), 'name'],
        })
      }
    }

    return {
      projectedFiles,
      projectedNameByFile,
      directNameInputPaths,
      modelBoundInputPaths: [],
    }
  }

  private getMessageStructuralInputPaths(inputs: AgentInputs): ResolvedSecretInputPath[] {
    const paths: ResolvedSecretInputPath[] = []
    for (let messageIndex = 0; messageIndex < (inputs.messages?.length ?? 0); messageIndex++) {
      const message = inputs.messages?.[messageIndex]
      if (!isPlainRecord(message)) continue
      const messageRoot = ['messages', String(messageIndex)] as const
      paths.push([...messageRoot, 'role'])
      if (message.name !== undefined) paths.push([...messageRoot, 'name'])
      if (message.tool_call_id !== undefined) paths.push([...messageRoot, 'tool_call_id'])

      if (isPlainRecord(message.function_call) && message.function_call.name !== undefined) {
        paths.push([...messageRoot, 'function_call', 'name'])
      }
      if (!Array.isArray(message.tool_calls)) continue
      for (let toolIndex = 0; toolIndex < message.tool_calls.length; toolIndex++) {
        const toolCall = message.tool_calls[toolIndex]
        if (!isPlainRecord(toolCall)) continue
        const toolRoot = [...messageRoot, 'tool_calls', String(toolIndex)]
        if (toolCall.id !== undefined) paths.push([...toolRoot, 'id'])
        if (toolCall.type !== undefined) paths.push([...toolRoot, 'type'])
        if (!isPlainRecord(toolCall.function)) continue
        if (toolCall.function.name !== undefined) {
          paths.push([...toolRoot, 'function', 'name'])
        }
      }
    }
    return paths
  }

  private getModelInputPaths(inputs: AgentInputs): ResolvedSecretInputPath[] {
    const paths: ResolvedSecretInputPath[] = [['systemPrompt'], ['userPrompt']]
    for (let index = 0; index < (inputs.messages?.length ?? 0); index++) {
      const message = inputs.messages?.[index]
      const messageRoot = ['messages', String(index)] as const
      paths.push([...messageRoot, 'content'])
      if (isPlainRecord(message?.function_call) && message.function_call.arguments !== undefined) {
        paths.push([...messageRoot, 'function_call', 'arguments'])
      }
      if (!Array.isArray(message?.tool_calls)) continue
      for (let toolIndex = 0; toolIndex < message.tool_calls.length; toolIndex++) {
        const toolCall = message.tool_calls[toolIndex]
        if (!isPlainRecord(toolCall) || !isPlainRecord(toolCall.function)) continue
        if (toolCall.function.arguments !== undefined) {
          paths.push([...messageRoot, 'tool_calls', String(toolIndex), 'function', 'arguments'])
        }
      }
    }

    const memories = inputs.memories
    const memoryArray = Array.isArray(memories)
      ? memories
      : Array.isArray(memories?.memories)
        ? memories.memories
        : []
    const memoryRoot = Array.isArray(memories) ? ['memories'] : ['memories', 'memories']
    for (let memoryIndex = 0; memoryIndex < memoryArray.length; memoryIndex++) {
      const memory = memoryArray[memoryIndex]
      if (Array.isArray(memory?.data)) {
        for (let messageIndex = 0; messageIndex < memory.data.length; messageIndex++) {
          paths.push([...memoryRoot, String(memoryIndex), 'data', String(messageIndex), 'content'])
        }
      } else {
        paths.push([...memoryRoot, String(memoryIndex), 'content'])
      }
    }
    return paths
  }

  private buildProviderRequest(config: {
    ctx: ExecutionContext
    providerId: string
    model: string
    messages: Message[] | undefined
    inputs: AgentInputs
    formattedTools: any[]
    responseFormat: any
    streaming: boolean
  }) {
    const { ctx, providerId, model, messages, inputs, formattedTools, responseFormat, streaming } =
      config

    const validMessages = this.validateMessages(messages)

    const { blockData, blockNameMapping } = collectBlockData(ctx)

    return {
      provider: providerId,
      model,
      systemPrompt: validMessages ? undefined : inputs.systemPrompt,
      context: validMessages ? undefined : stringifyJSON(messages),
      tools: formattedTools,
      temperature:
        inputs.temperature != null && inputs.temperature !== ''
          ? Number(inputs.temperature)
          : undefined,
      maxTokens:
        inputs.maxTokens != null && inputs.maxTokens !== '' ? Number(inputs.maxTokens) : undefined,
      apiKey: inputs.apiKey,
      azureEndpoint: inputs.azureEndpoint,
      azureApiVersion: inputs.azureApiVersion,
      vertexProject: inputs.vertexProject,
      vertexLocation: inputs.vertexLocation,
      vertexCredential: inputs.vertexCredential,
      bedrockAccessKeyId: inputs.bedrockAccessKeyId,
      bedrockSecretKey: inputs.bedrockSecretKey,
      bedrockRegion: inputs.bedrockRegion,
      responseFormat,
      workflowId: ctx.workflowId,
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      executionId: ctx.executionId,
      stream: streaming,
      messages: messages?.map(({ executionId, ...msg }) => msg),
      environmentVariables: normalizeStringRecord(ctx.environmentVariables),
      workflowVariables: normalizeWorkflowVariables(ctx.workflowVariables),
      blockData,
      blockNameMapping,
      reasoningEffort: inputs.reasoningEffort,
      verbosity: inputs.verbosity,
      thinkingLevel: inputs.thinkingLevel,
      promptCaching: inputs.promptCaching === true,
      previousInteractionId: inputs.previousInteractionId,
      /** Agent-events remains the opt-in for exposing thinking and tool lifecycle events. */
      agentEvents: streaming && ctx.metadata?.agentEvents === true,
    }
  }

  private validateMessages(messages: Message[] | undefined): boolean {
    return (
      Array.isArray(messages) &&
      messages.length > 0 &&
      messages.every(
        (msg: any) =>
          typeof msg === 'object' &&
          msg !== null &&
          'role' in msg &&
          typeof msg.role === 'string' &&
          ('content' in msg ||
            (msg.role === 'assistant' && ('function_call' in msg || 'tool_calls' in msg)))
      )
    )
  }

  private async executeProviderRequest(
    ctx: ExecutionContext,
    providerRequest: any,
    block: SerializedBlock,
    responseFormat: any,
    modelRuntimeRegistry: ResolvedSecretTraceRegistry | undefined,
    providerErrorRegistry: ResolvedSecretTraceRegistry | undefined
  ): Promise<BlockOutput | StreamingExecution> {
    const providerId = providerRequest.provider
    const model = providerRequest.model
    const providerStartTime = Date.now()

    try {
      let finalApiKey: string | undefined = providerRequest.apiKey

      if (providerId === 'vertex' && providerRequest.vertexCredential) {
        finalApiKey = await resolveVertexCredential({
          credentialId: providerRequest.vertexCredential,
          actingUserId: ctx.userId,
          workspaceId: ctx.workspaceId,
          workflowId: ctx.workflowId,
          callerLabel: 'vertex-agent',
        })
      }

      const { blockData, blockNameMapping } = collectBlockData(ctx)

      const response = await executeProviderRequest(
        providerId,
        {
          model,
          systemPrompt:
            'systemPrompt' in providerRequest ? providerRequest.systemPrompt : undefined,
          context: 'context' in providerRequest ? providerRequest.context : undefined,
          tools: providerRequest.tools,
          temperature: providerRequest.temperature,
          maxTokens: providerRequest.maxTokens,
          apiKey: finalApiKey,
          azureEndpoint: providerRequest.azureEndpoint,
          azureApiVersion: providerRequest.azureApiVersion,
          vertexProject: providerRequest.vertexProject,
          vertexLocation: providerRequest.vertexLocation,
          bedrockAccessKeyId: providerRequest.bedrockAccessKeyId,
          bedrockSecretKey: providerRequest.bedrockSecretKey,
          bedrockRegion: providerRequest.bedrockRegion,
          responseFormat: providerRequest.responseFormat,
          workflowId: providerRequest.workflowId,
          workspaceId: ctx.workspaceId,
          userId: ctx.userId,
          stream: providerRequest.stream,
          messages: 'messages' in providerRequest ? providerRequest.messages : undefined,
          environmentVariables: normalizeStringRecord(ctx.environmentVariables),
          workflowVariables: normalizeWorkflowVariables(ctx.workflowVariables),
          blockData,
          blockNameMapping,
          isDeployedContext: ctx.isDeployedContext,
          callChain: ctx.callChain,
          billingAttribution: ctx.metadata.billingAttribution,
          // Reaches tool `_context` via `prepareToolExecution`, so a tool that starts
          // its own child execution (a custom block) correlates and cancels against
          // this real run instead of minting a phantom id.
          executionId: ctx.executionId,
          reasoningEffort: providerRequest.reasoningEffort,
          verbosity: providerRequest.verbosity,
          thinkingLevel: providerRequest.thinkingLevel,
          promptCaching: providerRequest.promptCaching,
          // Stable per-block identity; providers use it to route cache lookups.
          blockId: block.id,
          previousInteractionId: providerRequest.previousInteractionId,
          agentEvents: providerRequest.agentEvents,
          abortSignal: ctx.abortSignal,
        },
        {
          resolvedSecretTraceRegistry: modelRuntimeRegistry,
          executionContext: ctx,
        }
      )

      return this.processProviderResponse(response, block, responseFormat, ctx)
    } catch (error) {
      const errorRegistry = this.createErrorRegistry(providerErrorRegistry, modelRuntimeRegistry)
      ctx.errorResolvedSecretTraceRegistry = errorRegistry
      const diagnosticCtx = errorRegistry
        ? { ...ctx, resolvedSecretTraceRegistry: errorRegistry }
        : ctx
      try {
        this.handleExecutionError(error, providerStartTime, providerId, model, diagnosticCtx, block)
      } finally {
        if (modelRuntimeRegistry) {
          ctx.resolvedSecretTraceRegistry = modelRuntimeRegistry.forkForPropagatedEntries()
        }
      }
      throw error
    }
  }

  private createErrorRegistry(
    inputRegistry: ResolvedSecretTraceRegistry | undefined,
    resultRegistry: ResolvedSecretTraceRegistry | undefined
  ): ResolvedSecretTraceRegistry | undefined {
    const errorRegistry = inputRegistry?.forkForToolCall() ?? resultRegistry?.forkForToolCall()
    if (errorRegistry && resultRegistry && resultRegistry !== inputRegistry) {
      errorRegistry.mergeToolCallRegistry(resultRegistry)
    }
    return errorRegistry
  }

  private handleExecutionError(
    error: any,
    startTime: number,
    provider: string,
    model: string,
    ctx: ExecutionContext,
    block: SerializedBlock
  ) {
    const executionTime = Date.now() - startTime

    logger.error(
      'Error executing provider request',
      projectAgentDiagnosticMetadata(
        ctx,
        {
          executionTime,
          provider,
          model,
          workflowId: ctx.workflowId,
          blockId: block.id,
          ...getErrorDiagnosticMetadata(error),
        },
        {
          executionTime,
          workflowId: ctx.workflowId,
          blockId: block.id,
          ...getErrorDiagnosticFallback(error),
        }
      )
    )

    if (!(error instanceof Error)) return

    /**
     * The original message is appended rather than replaced: providers annotate it with
     * the request phase they died in, which is the only thing separating a request that
     * was never answered from one whose body stalled.
     */
    if (isTransportTimeout(error)) {
      throw new Error(
        `Provider request timed out - the API took too long to respond (${error.message})`
      )
    }
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      throw new Error(
        'Network error - unable to connect to provider API. Please check your internet connection.'
      )
    }
    if (error.message.includes('ENOTFOUND') || error.message.includes('ECONNREFUSED')) {
      throw new Error('Unable to connect to server - DNS or connection issue')
    }
  }

  private wrapStreamForMemoryPersistence(
    ctx: ExecutionContext,
    inputs: AgentInputs,
    streamingExec: StreamingExecution
  ): StreamingExecution {
    return {
      ...streamingExec,
      onFullContent: async (content: string) => {
        if (!content.trim()) return
        try {
          await memoryService.appendToMemory(ctx, inputs, { role: 'assistant', content })
        } catch (error) {
          logger.error(
            'Failed to persist streaming response',
            projectAgentDiagnosticMetadata(
              ctx,
              getErrorDiagnosticMetadata(error),
              getErrorDiagnosticFallback(error)
            )
          )
        }
      },
    }
  }

  private async persistResponseToMemory(
    ctx: ExecutionContext,
    inputs: AgentInputs,
    result: BlockOutput
  ): Promise<void> {
    const content = (result as any)?.content
    if (!content || typeof content !== 'string') {
      return
    }

    try {
      await memoryService.appendToMemory(ctx, inputs, { role: 'assistant', content })
      logger.debug('Persisted assistant response to memory', {
        workflowId: ctx.workflowId,
      })
    } catch (error) {
      logger.error(
        'Failed to persist response to memory',
        projectAgentDiagnosticMetadata(
          ctx,
          getErrorDiagnosticMetadata(error),
          getErrorDiagnosticFallback(error)
        )
      )
    }
  }

  private processProviderResponse(
    response: any,
    block: SerializedBlock,
    responseFormat: any,
    ctx: ExecutionContext
  ): BlockOutput | StreamingExecution {
    if (this.isStreamingExecution(response)) {
      return this.processStreamingExecution(response, block)
    }

    if (response instanceof ReadableStream) {
      return this.createMinimalStreamingExecution(response)
    }

    return this.processRegularResponse(response, responseFormat, ctx)
  }

  private isStreamingExecution(response: any): boolean {
    return (
      response && typeof response === 'object' && 'stream' in response && 'execution' in response
    )
  }

  private processStreamingExecution(
    response: StreamingExecution,
    block: SerializedBlock
  ): StreamingExecution {
    const streamingExec = response as StreamingExecution

    if (streamingExec.execution.output) {
      const execution = streamingExec.execution as any
      if (block.metadata?.name) execution.blockName = block.metadata.name
      if (block.metadata?.id) execution.blockType = block.metadata.id
      execution.blockId = block.id
      execution.isStreaming = true
    }

    return streamingExec
  }

  private createMinimalStreamingExecution(stream: ReadableStream): StreamingExecution {
    return {
      stream,
      execution: {
        success: true,
        output: {},
        logs: [],
        metadata: {
          duration: DEFAULTS.EXECUTION_TIME,
          startTime: new Date().toISOString(),
        },
      },
    }
  }

  private processRegularResponse(
    result: any,
    responseFormat: any,
    ctx: ExecutionContext
  ): BlockOutput {
    if (responseFormat) {
      return this.processStructuredResponse(result, responseFormat, ctx)
    }

    return this.processStandardResponse(result)
  }

  private processStructuredResponse(
    result: any,
    responseFormat: any,
    ctx: ExecutionContext
  ): BlockOutput {
    const content = result.content

    try {
      const extractedJson = JSON.parse(content.trim())
      return {
        ...extractedJson,
        ...this.createResponseMetadata(result),
      }
    } catch (error) {
      logger.error(
        'LLM did not adhere to structured response format',
        projectAgentDiagnosticMetadata(
          ctx,
          {
            content: truncate(content, 200),
            responseFormat,
          },
          {
            contentLength: typeof content === 'string' ? content.length : undefined,
            hasResponseFormat: responseFormat !== undefined && responseFormat !== null,
          }
        )
      )

      const standardResponse = this.processStandardResponse(result)
      return Object.assign(standardResponse, {
        _responseFormatWarning:
          'LLM did not adhere to the specified structured response format. Expected valid JSON but received malformed content. Falling back to standard format.',
      })
    }
  }

  private processStandardResponse(result: any): BlockOutput {
    return {
      content: result.content,
      ...this.createResponseMetadata(result),
      ...(result.interactionId && { interactionId: result.interactionId }),
    }
  }

  private createResponseMetadata(result: {
    model?: string
    tokens?: { input?: number; output?: number; total?: number }
    toolCalls?: Array<any>
    timing?: any
    cost?: any
  }) {
    return {
      model: result.model,
      tokens: result.tokens || {
        input: DEFAULTS.TOKENS.PROMPT,
        output: DEFAULTS.TOKENS.COMPLETION,
        total: DEFAULTS.TOKENS.TOTAL,
      },
      toolCalls: {
        list: result.toolCalls?.map(this.formatToolCall.bind(this)) || [],
        count: result.toolCalls?.length ?? 0,
      },
      providerTiming: result.timing,
      cost: result.cost,
    }
  }

  private formatToolCall(tc: any) {
    const toolName = stripCustomToolPrefix(tc.name)

    return {
      ...tc,
      name: toolName,
      startTime: tc.startTime,
      endTime: tc.endTime,
      duration: tc.duration,
      arguments: tc.arguments || tc.input || {},
      result: tc.result || tc.output,
    }
  }
}
