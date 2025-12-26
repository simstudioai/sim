import { db } from '@sim/db'
import { account } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { refreshTokenIfNeeded } from '@/app/api/auth/oauth/utils'
import { generateRouterPrompt } from '@/blocks/blocks/router'
import type { BlockOutput } from '@/blocks/types'
import { BlockType, DEFAULTS, HTTP, isAgentBlockType, ROUTER } from '@/executor/constants'
import type { BlockHandler, ExecutionContext } from '@/executor/types'
import { calculateCost, getProviderFromModel } from '@/providers/utils'
import type { SerializedBlock } from '@/serializer/types'

const logger = createLogger('RouterBlockHandler')

/**
 * Handler for Router blocks that dynamically select execution paths.
 */
export class RouterBlockHandler implements BlockHandler {
  constructor(private pathTracker?: any) {}

  canHandle(block: SerializedBlock): boolean {
    return block.metadata?.id === BlockType.ROUTER
  }

  async execute(
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
    }

    const providerId = getProviderFromModel(routerConfig.model)

    try {
      const url = new URL('/api/providers', getBaseUrl())

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
        workflowId: ctx.workflowId,
        workspaceId: ctx.workspaceId,
      }

      if (providerId === 'vertex') {
        providerRequest.vertexProject = routerConfig.vertexProject
        providerRequest.vertexLocation = routerConfig.vertexLocation
      }

      if (providerId === 'azure-openai') {
        providerRequest.azureEndpoint = inputs.azureEndpoint
        providerRequest.azureApiVersion = inputs.azureApiVersion
      }

      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': HTTP.CONTENT_TYPE.JSON,
        },
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
          systemPrompt =
            targetBlock.config?.params?.systemPrompt || targetBlock.inputs?.systemPrompt || ''

          if (!systemPrompt && targetBlock.inputs) {
            systemPrompt = targetBlock.inputs.systemPrompt || ''
          }
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
