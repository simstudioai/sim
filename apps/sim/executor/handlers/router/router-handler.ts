import { createLogger } from '@sim/logger'
import { projectResolvedModelInput } from '@/lib/execution/model-input-provenance'
import {
  type AutoRoutingResult,
  addAutoRoutingCost,
  resolveAutoModel,
  SIM_AUTO_SYSTEM_PREAMBLE,
} from '@/lib/model-router/resolve'
import { generateRouterPrompt, generateRouterV2Prompt } from '@/blocks/blocks/router'
import type { BlockOutput } from '@/blocks/types'
import { validateModelProvider } from '@/ee/access-control/utils/permission-check'
import {
  BlockType,
  DEFAULTS,
  isAgentBlockType,
  isRouterV2BlockType,
  ROUTER,
} from '@/executor/constants'
import type { BlockHandler, ExecutionContext } from '@/executor/types'
import { executeBlockProviderRequest } from '@/executor/utils/provider-request'
import { refuseResolvedSecretProjection } from '@/executor/utils/resolved-secret-projection-refusal'
import type { ResolvedSecretInputPath } from '@/executor/utils/resolved-secret-trace-registry'
import { resolveVertexCredential } from '@/executor/utils/vertex-credential'
import { resolveProxiedModelCost } from '@/providers/cost-policy'
import { isAutoModel, SIM_AUTO_MODEL_ID } from '@/providers/models'
import type { ProviderRequest } from '@/providers/types'
import { getProviderFromModel } from '@/providers/utils'
import type { SerializedBlock } from '@/serializer/types'

const logger = createLogger('RouterBlockHandler')

interface RouteDefinition {
  id: string
  title: string
  value: string
}

/**
 * Handler for Router blocks that dynamically select execution paths.
 * Supports both legacy router (block-based) and router_v2 (port-based).
 */
export class RouterBlockHandler implements BlockHandler {
  constructor(private pathTracker?: any) {}

  canHandle(block: SerializedBlock): boolean {
    return block.metadata?.id === BlockType.ROUTER || block.metadata?.id === BlockType.ROUTER_V2
  }

  async execute(
    ctx: ExecutionContext,
    block: SerializedBlock,
    inputs: Record<string, any>
  ): Promise<BlockOutput> {
    const isV2 = isRouterV2BlockType(block.metadata?.id)

    if (isV2) {
      return this.executeV2(ctx, block, inputs)
    }

    return this.executeLegacy(ctx, block, inputs)
  }

  /**
   * Execute legacy router (block-based routing).
   */
  private async executeLegacy(
    ctx: ExecutionContext,
    block: SerializedBlock,
    inputs: Record<string, any>
  ): Promise<BlockOutput> {
    const promptModelInputPaths: ResolvedSecretInputPath[] = [['prompt']]
    const modelInputProjection = projectResolvedModelInput(
      ctx.resolvedSecretTraceRegistry,
      { prompt: inputs.prompt },
      promptModelInputPaths
    )
    if (!modelInputProjection.complete) {
      refuseResolvedSecretProjection({
        site: 'router.promptModelInput',
        message: 'Router model input could not be safely projected',
        registry: ctx.resolvedSecretTraceRegistry,
        inputPath: 'prompt',
      })
    }
    const targetBlocks = this.getTargetBlocks(ctx, block)

    const routerConfig = {
      prompt: modelInputProjection.value.prompt,
      model: inputs.model || ROUTER.DEFAULT_MODEL,
      apiKey: inputs.apiKey,
      vertexProject: inputs.vertexProject,
      vertexLocation: inputs.vertexLocation,
      vertexCredential: inputs.vertexCredential,
      bedrockAccessKeyId: inputs.bedrockAccessKeyId,
      bedrockSecretKey: inputs.bedrockSecretKey,
      bedrockRegion: inputs.bedrockRegion,
    }

    try {
      const messages = [{ role: 'user', content: routerConfig.prompt }]
      const systemPrompt = generateRouterPrompt(routerConfig.prompt, targetBlocks)
      const resolved = await this.resolveModel(
        ctx,
        block.id,
        routerConfig.model,
        systemPrompt,
        routerConfig.prompt,
        false
      )

      await validateModelProvider(ctx.userId, ctx.workspaceId, resolved.model, ctx)
      const providerId = getProviderFromModel(resolved.model)

      let finalApiKey: string | undefined = routerConfig.apiKey
      if (providerId === 'vertex' && routerConfig.vertexCredential) {
        finalApiKey = await resolveVertexCredential({
          credentialId: routerConfig.vertexCredential,
          actingUserId: ctx.userId,
          workspaceId: ctx.workspaceId,
          workflowId: ctx.workflowId,
          callerLabel: 'vertex-router',
        })
      }

      const providerRequest: ProviderRequest = {
        model: resolved.model,
        systemPrompt: resolved.systemPrompt,
        context: JSON.stringify(messages),
        temperature: ROUTER.INFERENCE_TEMPERATURE,
        apiKey: finalApiKey,
        azureEndpoint: inputs.azureEndpoint,
        azureApiVersion: inputs.azureApiVersion,
        vertexProject: routerConfig.vertexProject,
        vertexLocation: routerConfig.vertexLocation,
        bedrockAccessKeyId: routerConfig.bedrockAccessKeyId,
        bedrockSecretKey: routerConfig.bedrockSecretKey,
        bedrockRegion: routerConfig.bedrockRegion,
        workflowId: ctx.workflowId,
        workspaceId: ctx.workspaceId,
      }

      const result = await executeBlockProviderRequest({
        ctx,
        providerId,
        request: providerRequest,
        resolvedSecretTraceRegistry: modelInputProjection.registry,
      })

      const chosenBlockId = result.content.trim().toLowerCase()
      const chosenBlock = targetBlocks?.find((b) => b.id === chosenBlockId)

      if (!chosenBlock) {
        logger.error('Invalid routing decision', {
          responseContentType: typeof result.content,
          responseContentLength:
            typeof result.content === 'string' ? result.content.length : undefined,
          availableBlockCount: targetBlocks?.length ?? 0,
        })
        throw new Error(`Invalid routing decision: ${chosenBlockId}`)
      }

      const tokens = result.tokens || {
        input: DEFAULTS.TOKENS.PROMPT,
        output: DEFAULTS.TOKENS.COMPLETION,
        total: DEFAULTS.TOKENS.TOTAL,
      }

      const cost = addAutoRoutingCost(
        resolveProxiedModelCost(result.cost),
        resolved.autoRouting?.billableRoutingCost ?? 0
      )

      return {
        prompt: inputs.prompt,
        model: resolved.autoRouting ? SIM_AUTO_MODEL_ID : result.model,
        tokens: {
          input: tokens.input || DEFAULTS.TOKENS.PROMPT,
          output: tokens.output || DEFAULTS.TOKENS.COMPLETION,
          total: tokens.total || DEFAULTS.TOKENS.TOTAL,
        },
        cost: {
          input: cost.input,
          output: cost.output,
          total: cost.total,
          ...(cost.routing === undefined ? {} : { routing: cost.routing }),
        },
        selectedPath: {
          blockId: chosenBlock.id,
          blockType: chosenBlock.type || DEFAULTS.BLOCK_TYPE,
          blockTitle: chosenBlock.title || DEFAULTS.BLOCK_TITLE,
        },
        selectedRoute: String(chosenBlock.id),
      } as BlockOutput
    } catch (error) {
      logger.error('Router execution failed', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      })
      throw error
    }
  }

  /**
   * Execute router v2 (port-based routing).
   * Uses route definitions with descriptions instead of downstream block names.
   */
  private async executeV2(
    ctx: ExecutionContext,
    block: SerializedBlock,
    inputs: Record<string, any>
  ): Promise<BlockOutput> {
    const routes = this.parseRoutes(inputs.routes)

    if (routes.length === 0) {
      throw new Error('No routes defined for router')
    }

    const modelInputPaths: ResolvedSecretInputPath[] = [
      ['context'],
      ...(Array.isArray(inputs.routes)
        ? inputs.routes.map((_, index) => ['routes', String(index), 'value'] as const)
        : [['routes'] as const]),
    ]
    const modelInputProjection = projectResolvedModelInput(
      ctx.resolvedSecretTraceRegistry,
      { context: inputs.context, routes: inputs.routes },
      modelInputPaths
    )
    if (!modelInputProjection.complete) {
      refuseResolvedSecretProjection({
        site: 'router.contextModelInput',
        message: 'Router model input could not be safely projected',
        registry: ctx.resolvedSecretTraceRegistry,
        inputPath: 'context,routes',
      })
    }
    const projectedRoutes = this.parseRoutes(modelInputProjection.value.routes)
    if (projectedRoutes.length !== routes.length) {
      refuseResolvedSecretProjection({
        site: 'router.routeArity',
        message: 'Router model input could not be safely projected',
        registry: ctx.resolvedSecretTraceRegistry,
        inputPath: 'routes',
      })
    }
    const modelRoutes = routes.map((route, index) => ({
      ...route,
      value: projectedRoutes[index]?.value ?? route.value,
    }))

    const routerConfig = {
      context: modelInputProjection.value.context,
      model: inputs.model || ROUTER.DEFAULT_MODEL,
      apiKey: inputs.apiKey,
      vertexProject: inputs.vertexProject,
      vertexLocation: inputs.vertexLocation,
      vertexCredential: inputs.vertexCredential,
      bedrockAccessKeyId: inputs.bedrockAccessKeyId,
      bedrockSecretKey: inputs.bedrockSecretKey,
      bedrockRegion: inputs.bedrockRegion,
    }

    try {
      const messages = [{ role: 'user', content: routerConfig.context }]
      const systemPrompt = generateRouterV2Prompt(routerConfig.context, modelRoutes)
      const resolved = await this.resolveModel(
        ctx,
        block.id,
        routerConfig.model,
        systemPrompt,
        routerConfig.context,
        true
      )

      await validateModelProvider(ctx.userId, ctx.workspaceId, resolved.model, ctx)
      const providerId = getProviderFromModel(resolved.model)

      let finalApiKey: string | undefined = routerConfig.apiKey
      if (providerId === 'vertex' && routerConfig.vertexCredential) {
        finalApiKey = await resolveVertexCredential({
          credentialId: routerConfig.vertexCredential,
          actingUserId: ctx.userId,
          workspaceId: ctx.workspaceId,
          workflowId: ctx.workflowId,
          callerLabel: 'vertex-router',
        })
      }

      const providerRequest: ProviderRequest = {
        model: resolved.model,
        systemPrompt: resolved.systemPrompt,
        context: JSON.stringify(messages),
        temperature: ROUTER.INFERENCE_TEMPERATURE,
        apiKey: finalApiKey,
        azureEndpoint: inputs.azureEndpoint,
        azureApiVersion: inputs.azureApiVersion,
        vertexProject: routerConfig.vertexProject,
        vertexLocation: routerConfig.vertexLocation,
        bedrockAccessKeyId: routerConfig.bedrockAccessKeyId,
        bedrockSecretKey: routerConfig.bedrockSecretKey,
        bedrockRegion: routerConfig.bedrockRegion,
        workflowId: ctx.workflowId,
        workspaceId: ctx.workspaceId,
        responseFormat: {
          name: 'router_response',
          schema: {
            type: 'object',
            properties: {
              route: {
                type: 'string',
                description: 'The selected route ID or NO_MATCH',
              },
              reasoning: {
                type: 'string',
                description: 'Brief explanation of why this route was chosen',
              },
            },
            required: ['route', 'reasoning'],
            additionalProperties: false,
          },
          strict: true,
        },
      }

      const result = await executeBlockProviderRequest({
        ctx,
        providerId,
        request: providerRequest,
        resolvedSecretTraceRegistry: modelInputProjection.registry,
      })

      let chosenRouteId: string
      let reasoning = ''

      try {
        const parsedResponse = JSON.parse(result.content)
        chosenRouteId = parsedResponse.route?.trim() || ''
        reasoning = parsedResponse.reasoning || ''
      } catch (error) {
        logger.error('Router response was not valid JSON despite responseFormat', {
          errorName: error instanceof Error ? error.name : 'UnknownError',
          responseContentType: typeof result.content,
          responseContentLength:
            typeof result.content === 'string' ? result.content.length : undefined,
        })
        chosenRouteId = result.content.trim()
      }

      if (chosenRouteId === 'NO_MATCH' || chosenRouteId.toUpperCase() === 'NO_MATCH') {
        logger.info('Router determined no route matches the context, routing to error path')
        throw new Error(
          reasoning
            ? `Router could not determine a matching route: ${reasoning}`
            : 'Router could not determine a matching route for the given context'
        )
      }

      const chosenRoute = routes.find((r) => r.id === chosenRouteId)

      if (!chosenRoute) {
        logger.error('Invalid routing decision', {
          responseContentType: typeof result.content,
          responseContentLength:
            typeof result.content === 'string' ? result.content.length : undefined,
          availableRouteCount: routes.length,
        })
        throw new Error(
          `Router could not determine a valid route. LLM response: "${result.content}". Available route IDs: ${routes.map((r) => r.id).join(', ')}`
        )
      }

      const connection = ctx.workflow?.connections.find(
        (conn) => conn.source === block.id && conn.sourceHandle === `router-${chosenRoute.id}`
      )

      const targetBlock = connection
        ? ctx.workflow?.blocks.find((b) => b.id === connection.target)
        : null

      const tokens = result.tokens || {
        input: DEFAULTS.TOKENS.PROMPT,
        output: DEFAULTS.TOKENS.COMPLETION,
        total: DEFAULTS.TOKENS.TOTAL,
      }

      const cost = addAutoRoutingCost(
        resolveProxiedModelCost(result.cost),
        resolved.autoRouting?.billableRoutingCost ?? 0
      )

      return {
        context: inputs.context,
        model: resolved.autoRouting ? SIM_AUTO_MODEL_ID : result.model,
        tokens: {
          input: tokens.input || DEFAULTS.TOKENS.PROMPT,
          output: tokens.output || DEFAULTS.TOKENS.COMPLETION,
          total: tokens.total || DEFAULTS.TOKENS.TOTAL,
        },
        cost: {
          input: cost.input,
          output: cost.output,
          total: cost.total,
          ...(cost.routing === undefined ? {} : { routing: cost.routing }),
        },
        selectedRoute: chosenRoute.id,
        reasoning,
        selectedPath: targetBlock
          ? {
              blockId: targetBlock.id,
              blockType: targetBlock.metadata?.id || DEFAULTS.BLOCK_TYPE,
              blockTitle: targetBlock.metadata?.name || DEFAULTS.BLOCK_TITLE,
            }
          : {
              blockId: '',
              blockType: DEFAULTS.BLOCK_TYPE,
              blockTitle: chosenRoute.title,
            },
      } as BlockOutput
    } catch (error) {
      logger.error('Router V2 execution failed', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      })
      throw error
    }
  }

  /**
   * Parse routes from input (can be JSON string or array)
   */
  private parseRoutes(input: any): RouteDefinition[] {
    try {
      if (typeof input === 'string') {
        return JSON.parse(input)
      }
      if (Array.isArray(input)) {
        return input
      }
      return []
    } catch (error) {
      logger.error('Failed to parse routes', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
        inputType: typeof input,
        inputLength: typeof input === 'string' ? input.length : undefined,
      })
      return []
    }
  }

  private async resolveModel(
    ctx: ExecutionContext,
    blockId: string,
    configuredModel: string,
    systemPrompt: string,
    lastMessage: unknown,
    hasResponseFormat: boolean
  ): Promise<{
    model: string
    systemPrompt: string
    autoRouting: AutoRoutingResult | null
  }> {
    if (!isAutoModel(configuredModel)) {
      return { model: configuredModel, systemPrompt, autoRouting: null }
    }

    const message =
      typeof lastMessage === 'string' ? lastMessage : JSON.stringify(lastMessage ?? '')
    const autoRouting = await resolveAutoModel({
      ctx,
      blockId,
      signals: {
        systemPrompt,
        lastMessage: message,
        messageCount: 1,
        toolNames: [],
        mediaKind: 'none',
        hasResponseFormat,
        approxInputTokens: Math.ceil((systemPrompt.length + message.length) / 4),
      },
      fallbackModel: ROUTER.DEFAULT_MODEL,
    })

    logger.info('Resolved sim-auto model for router', {
      blockId,
      model: autoRouting.model,
      tier: autoRouting.tier,
      decidedBy: autoRouting.decidedBy,
    })

    return {
      model: autoRouting.model,
      systemPrompt: [SIM_AUTO_SYSTEM_PREAMBLE, systemPrompt].filter(Boolean).join('\n\n'),
      autoRouting,
    }
  }

  private getTargetBlocks(ctx: ExecutionContext, block: SerializedBlock) {
    const targetBlocks = []
    const connections = ctx.workflow?.connections.filter((conn) => conn.source === block.id) ?? []

    for (const conn of connections) {
      const targetBlock = ctx.workflow?.blocks.find((candidate) => candidate.id === conn.target)
      if (!targetBlock) {
        throw new Error(`Target block ${conn.target} not found`)
      }

      let systemPrompt = ''
      if (isAgentBlockType(targetBlock.metadata?.id)) {
        const paramsPrompt = targetBlock.config?.params?.systemPrompt
        const inputsPrompt = targetBlock.inputs?.systemPrompt
        systemPrompt =
          (typeof paramsPrompt === 'string' ? paramsPrompt : '') ||
          (typeof inputsPrompt === 'string' ? inputsPrompt : '') ||
          ''
      }

      const targetState = ctx.blockStates.get(targetBlock.id)
      const stateProvenance = targetState?.resolvedSecretTraceProvenance
      const currentState =
        stateProvenance && (!stateProvenance.complete || stateProvenance.entries.length > 0)
          ? undefined
          : targetState?.output

      targetBlocks.push({
        id: targetBlock.id,
        type: targetBlock.metadata?.id,
        title: targetBlock.metadata?.name,
        description: targetBlock.metadata?.description,
        subBlocks: {
          ...targetBlock.config.params,
          systemPrompt,
        },
        currentState,
      })
    }

    return targetBlocks
  }
}
