import { db } from '@sim/db'
import { account } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { refreshTokenIfNeeded } from '@/app/api/auth/oauth/utils'
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
import { buildAuthHeaders } from '@/executor/utils/http'
import { calculateCost, getProviderFromModel } from '@/providers/utils'
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
    const targetBlocks = this.getTargetBlocks(ctx, block)

    const routerConfig = {
      prompt: inputs.prompt,
      model: inputs.model || ROUTER.DEFAULT_MODEL,
      apiKey: inputs.apiKey,
      vertexProject: inputs.vertexProject,
      vertexLocation: inputs.vertexLocation,
      vertexCredential: inputs.vertexCredential,
      bedrockAccessKeyId: inputs.bedrockAccessKeyId,
      bedrockSecretKey: inputs.bedrockSecretKey,
      bedrockRegion: inputs.bedrockRegion,
    }

    await validateModelProvider(ctx.userId, routerConfig.model, ctx)

    const providerId = getProviderFromModel(routerConfig.model)

    try {
      const url = new URL('/api/providers', getBaseUrl())
      if (ctx.userId) url.searchParams.set('userId', ctx.userId)

      const messages = [{ role: 'user', content: routerConfig.prompt }]
      const systemPrompt = generateRouterPrompt(routerConfig.prompt, targetBlocks)

      let finalApiKey: string | undefined = routerConfig.apiKey
      if (providerId === 'vertex' && routerConfig.vertexCredential) {
        finalApiKey = await this.resolveVertexCredential(routerConfig.vertexCredential)
      }

      const providerRequest: Record<string, any> = {
        provider: providerId,
        model: routerConfig.model,
        systemPrompt: systemPrompt,
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

      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: await buildAuthHeaders(),
        body: JSON.stringify(providerRequest),
      })

      if (!response.ok) {
        let errorMessage = `Provider API request failed with status ${response.status}`
        try {
          const errorData = await response.json()
          if (errorData.error) {
            errorMessage = errorData.error
          }
        } catch (_e) {}
        throw new Error(errorMessage)
      }

      const result = await response.json()

      const chosenBlockId = result.content.trim().toLowerCase()
      const chosenBlock = targetBlocks?.find((b) => b.id === chosenBlockId)

      if (!chosenBlock) {
        logger.error(
          `Invalid routing decision. Response content: "${result.content}", available blocks:`,
          targetBlocks?.map((b) => ({ id: b.id, title: b.title })) || []
        )
        throw new Error(`Invalid routing decision: ${chosenBlockId}`)
      }

      const tokens = result.tokens || {
        input: DEFAULTS.TOKENS.PROMPT,
        output: DEFAULTS.TOKENS.COMPLETION,
        total: DEFAULTS.TOKENS.TOTAL,
      }

      const cost = calculateCost(
        result.model,
        tokens.input || DEFAULTS.TOKENS.PROMPT,
        tokens.output || DEFAULTS.TOKENS.COMPLETION,
        false
      )

      return {
        prompt: inputs.prompt,
        model: result.model,
        tokens: {
          input: tokens.input || DEFAULTS.TOKENS.PROMPT,
          output: tokens.output || DEFAULTS.TOKENS.COMPLETION,
          total: tokens.total || DEFAULTS.TOKENS.TOTAL,
        },
        cost: {
          input: cost.input,
          output: cost.output,
          total: cost.total,
        },
        selectedPath: {
          blockId: chosenBlock.id,
          blockType: chosenBlock.type || DEFAULTS.BLOCK_TYPE,
          blockTitle: chosenBlock.title || DEFAULTS.BLOCK_TITLE,
        },
        selectedRoute: String(chosenBlock.id),
      } as BlockOutput
    } catch (error) {
      logger.error('Router execution failed:', error)
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

    const routerConfig = {
      context: inputs.context,
      model: inputs.model || ROUTER.DEFAULT_MODEL,
      apiKey: inputs.apiKey,
      vertexProject: inputs.vertexProject,
      vertexLocation: inputs.vertexLocation,
      vertexCredential: inputs.vertexCredential,
      bedrockAccessKeyId: inputs.bedrockAccessKeyId,
      bedrockSecretKey: inputs.bedrockSecretKey,
      bedrockRegion: inputs.bedrockRegion,
    }

    await validateModelProvider(ctx.userId, routerConfig.model, ctx)

    const providerId = getProviderFromModel(routerConfig.model)

    try {
      const url = new URL('/api/providers', getBaseUrl())
      if (ctx.userId) url.searchParams.set('userId', ctx.userId)

      const messages = [{ role: 'user', content: routerConfig.context }]
      const systemPrompt = generateRouterV2Prompt(routerConfig.context, routes)

      let finalApiKey: string | undefined = routerConfig.apiKey
      if (providerId === 'vertex' && routerConfig.vertexCredential) {
        finalApiKey = await this.resolveVertexCredential(routerConfig.vertexCredential)
      }

      const providerRequest: Record<string, any> = {
        provider: providerId,
        model: routerConfig.model,
        systemPrompt: systemPrompt,
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

      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: await buildAuthHeaders(),
        body: JSON.stringify(providerRequest),
      })

      if (!response.ok) {
        let errorMessage = `Provider API request failed with status ${response.status}`
        try {
          const errorData = await response.json()
          if (errorData.error) {
            errorMessage = errorData.error
          }
        } catch (_e) {}
        throw new Error(errorMessage)
      }

      const result = await response.json()

      let chosenRouteId: string
      let reasoning = ''

      try {
        const parsedResponse = JSON.parse(result.content)
        chosenRouteId = parsedResponse.route?.trim() || ''
        reasoning = parsedResponse.reasoning || ''
      } catch (_parseError) {
        logger.error('Router response was not valid JSON despite responseFormat', {
          content: result.content,
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
        const availableRoutes = routes.map((r) => ({ id: r.id, title: r.title }))
        logger.error(
          `Invalid routing decision. Response content: "${result.content}". Available routes:`,
          availableRoutes
        )
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

      const cost = calculateCost(
        result.model,
        tokens.input || DEFAULTS.TOKENS.PROMPT,
        tokens.output || DEFAULTS.TOKENS.COMPLETION,
        false
      )

      return {
        context: inputs.context,
        model: result.model,
        tokens: {
          input: tokens.input || DEFAULTS.TOKENS.PROMPT,
          output: tokens.output || DEFAULTS.TOKENS.COMPLETION,
          total: tokens.total || DEFAULTS.TOKENS.TOTAL,
        },
        cost: {
          input: cost.input,
          output: cost.output,
          total: cost.total,
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
      logger.error('Router V2 execution failed:', error)
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
      logger.error('Failed to parse routes:', { input, error })
      return []
    }
  }

  private getTargetBlocks(ctx: ExecutionContext, block: SerializedBlock) {
    return ctx.workflow?.connections
      .filter((conn) => conn.source === block.id)
      .map((conn) => {
        const targetBlock = ctx.workflow?.blocks.find((b) => b.id === conn.target)
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

        return {
          id: targetBlock.id,
          type: targetBlock.metadata?.id,
          title: targetBlock.metadata?.name,
          description: targetBlock.metadata?.description,
          subBlocks: {
            ...targetBlock.config.params,
            systemPrompt: systemPrompt,
          },
          currentState: ctx.blockStates.get(targetBlock.id)?.output,
        }
      })
  }

  /**
   * Resolves a Vertex AI OAuth credential to an access token
   */
  private async resolveVertexCredential(credentialId: string): Promise<string> {
    const requestId = `vertex-router-${Date.now()}`

    logger.info(`[${requestId}] Resolving Vertex AI credential: ${credentialId}`)

    const credential = await db.query.account.findFirst({
      where: eq(account.id, credentialId),
    })

    if (!credential) {
      throw new Error(`Vertex AI credential not found: ${credentialId}`)
    }

    const { accessToken } = await refreshTokenIfNeeded(requestId, credential, credentialId)

    if (!accessToken) {
      throw new Error('Failed to get Vertex AI access token')
    }

    logger.info(`[${requestId}] Successfully resolved Vertex AI credential`)
    return accessToken
  }
}
