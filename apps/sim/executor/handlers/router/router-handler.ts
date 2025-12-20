import { createLogger } from '@/lib/logs/console/logger'
import type { BlockOutput } from '@/blocks/types'
import { BlockType, DEFAULTS, EDGE } from '@/executor/constants'
import { evaluateConditionExpression } from '@/executor/handlers/condition/condition-handler'
import type { BlockHandler, ExecutionContext } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'

const logger = createLogger('RouterBlockHandler')

const ROUTER = {
  ELSE_TITLE: 'else',
} as const

/**
 * Handler for Router blocks that evaluate conditions to determine execution paths.
 * Works similarly to the ConditionBlockHandler but with router-specific logic.
 */
export class RouterBlockHandler implements BlockHandler {
  canHandle(block: SerializedBlock): boolean {
    return block.metadata?.id === BlockType.ROUTER
  }

  async execute(
    ctx: ExecutionContext,
    block: SerializedBlock,
    inputs: Record<string, any>
  ): Promise<BlockOutput> {
    const routes = this.parseRoutes(inputs.routes)

    const sourceBlockId = ctx.workflow?.connections.find((conn) => conn.target === block.id)?.source
    const evalContext = this.buildEvaluationContext(ctx, sourceBlockId)
    const sourceOutput = sourceBlockId ? ctx.blockStates.get(sourceBlockId)?.output : null

    const outgoingConnections = ctx.workflow?.connections.filter((conn) => conn.source === block.id)

    const { selectedConnection, selectedRoute } = await this.evaluateRoutes(
      routes,
      outgoingConnections || [],
      evalContext,
      ctx
    )

    if (!selectedConnection || !selectedRoute) {
      return {
        ...((sourceOutput as any) || {}),
        conditionResult: false,
        selectedPath: null,
        selectedOption: null,
      }
    }

    const targetBlock = ctx.workflow?.blocks.find((b) => b.id === selectedConnection?.target)
    if (!targetBlock) {
      throw new Error(`Target block ${selectedConnection?.target} not found`)
    }

    const decisionKey = ctx.currentVirtualBlockId || block.id
    ctx.decisions.router.set(decisionKey, selectedRoute.id)

    return {
      ...((sourceOutput as any) || {}),
      conditionResult: true,
      selectedPath: {
        blockId: targetBlock.id,
        blockType: targetBlock.metadata?.id || DEFAULTS.BLOCK_TYPE,
        blockTitle: targetBlock.metadata?.name || DEFAULTS.BLOCK_TITLE,
      },
      selectedOption: selectedRoute.id,
    }
  }

  private parseRoutes(input: any): Array<{ id: string; title: string; value: string }> {
    try {
      const routes = Array.isArray(input) ? input : JSON.parse(input || '[]')
      return routes
    } catch (error: any) {
      logger.error('Failed to parse routes:', { input, error })
      throw new Error(`Invalid routes format: ${error.message}`)
    }
  }

  private buildEvaluationContext(
    ctx: ExecutionContext,
    sourceBlockId?: string
  ): Record<string, any> {
    let evalContext: Record<string, any> = {}

    if (sourceBlockId) {
      const sourceOutput = ctx.blockStates.get(sourceBlockId)?.output
      if (sourceOutput && typeof sourceOutput === 'object' && sourceOutput !== null) {
        evalContext = {
          ...evalContext,
          ...sourceOutput,
        }
      }
    }

    return evalContext
  }

  private async evaluateRoutes(
    routes: Array<{ id: string; title: string; value: string }>,
    outgoingConnections: Array<{ source: string; target: string; sourceHandle?: string }>,
    evalContext: Record<string, any>,
    ctx: ExecutionContext
  ): Promise<{
    selectedConnection: { target: string; sourceHandle?: string } | null
    selectedRoute: { id: string; title: string; value: string } | null
  }> {
    for (const route of routes) {
      if (route.title === ROUTER.ELSE_TITLE) {
        const connection = this.findConnectionForRoute(outgoingConnections, route.id)
        if (connection) {
          return { selectedConnection: connection, selectedRoute: route }
        }
        continue
      }

      const routeValueString = String(route.value || '')
      try {
        const conditionMet = await evaluateConditionExpression(ctx, routeValueString, evalContext)

        if (conditionMet) {
          const connection = this.findConnectionForRoute(outgoingConnections, route.id)
          if (connection) {
            return { selectedConnection: connection, selectedRoute: route }
          }
          // Condition is true but has no outgoing edge - branch ends gracefully
          return { selectedConnection: null, selectedRoute: null }
        }
      } catch (error: any) {
        logger.error(`Failed to evaluate route "${route.title}": ${error.message}`)
        throw new Error(`Evaluation error in route "${route.title}": ${error.message}`)
      }
    }

    const elseRoute = routes.find((r) => r.title === ROUTER.ELSE_TITLE)
    if (elseRoute) {
      const elseConnection = this.findConnectionForRoute(outgoingConnections, elseRoute.id)
      if (elseConnection) {
        return { selectedConnection: elseConnection, selectedRoute: elseRoute }
      }
      return { selectedConnection: null, selectedRoute: null }
    }

    return { selectedConnection: null, selectedRoute: null }
  }

  private findConnectionForRoute(
    connections: Array<{ source: string; target: string; sourceHandle?: string }>,
    routeId: string
  ): { target: string; sourceHandle?: string } | undefined {
    return connections.find((conn) => conn.sourceHandle === `${EDGE.ROUTER_PREFIX}${routeId}`)
  }
}
