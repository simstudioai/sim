import { createLogger } from '@sim/logger'
import { normalizeStringRecord, normalizeWorkflowVariables } from '@/lib/core/utils/records'
import { isElseConditionTitle } from '@/lib/workflows/conditions'
import type { BlockOutput } from '@/blocks/types'
import { BlockType, DEFAULTS, EDGE } from '@/executor/constants'
import type { BlockHandler, ExecutionContext } from '@/executor/types'
import { collectBlockData } from '@/executor/utils/block-data'
import {
  buildBranchNodeId,
  extractBaseBlockId,
  extractBranchIndex,
  isBranchNodeId,
} from '@/executor/utils/subflow-utils'
import type { SerializedBlock } from '@/serializer/types'
import { executeTool } from '@/tools'

const logger = createLogger('ConditionBlockHandler')

const CONDITION_TIMEOUT_MS = 5000

/**
 * Evaluates a single condition expression.
 * The resolver preserves legacy Condition expression substitution before this function executes the
 * resulting JavaScript through the shared function execution boundary.
 *
 * `blockData` is deliberately empty: the resolver already inlines every `<block.field>` reference
 * into the expression before this runs, so shipping the run's accumulated block outputs would only
 * inflate the request body. Sending them blew the 10MB body cap on wide subflows, where a single
 * flat `blockStates` map holds every branch's outputs.
 *
 * Returns true if condition is met, false otherwise.
 */
async function evaluateConditionExpression(
  ctx: ExecutionContext,
  conditionExpression: string,
  providedEvalContext?: Record<string, any>,
  currentNodeId?: string
): Promise<boolean> {
  const evalContext = providedEvalContext || {}

  try {
    const contextSetup = `const context = ${JSON.stringify(evalContext)};`
    const code = `${contextSetup}\nreturn Boolean(${conditionExpression})`

    const { blockNameMapping, blockOutputSchemas } = collectBlockData(ctx, currentNodeId)

    const result = await executeTool(
      'function_execute',
      {
        code,
        timeout: CONDITION_TIMEOUT_MS,
        envVars: normalizeStringRecord(ctx.environmentVariables),
        workflowVariables: normalizeWorkflowVariables(ctx.workflowVariables),
        blockData: {},
        blockNameMapping,
        blockOutputSchemas,
        _context: {
          workflowId: ctx.workflowId,
          workspaceId: ctx.workspaceId,
          userId: ctx.userId,
          isDeployedContext: ctx.isDeployedContext,
          enforceCredentialAccess: ctx.enforceCredentialAccess,
        },
      },
      { executionContext: ctx }
    )

    if (!result.success) {
      logger.error('Failed to evaluate condition', {
        hasRuntimeError: Boolean(result.error),
      })
      throw new Error(`Evaluation error in condition: ${result.error}`)
    }

    return Boolean(result.output?.result)
  } catch (evalError: any) {
    logger.error('Failed to evaluate condition', {
      errorName: evalError?.name,
    })
    throw new Error(`Evaluation error in condition: ${evalError.message}`)
  }
}

/**
 * Handler for Condition blocks that evaluate expressions to determine execution paths.
 */
export class ConditionBlockHandler implements BlockHandler {
  canHandle(block: SerializedBlock): boolean {
    return block.metadata?.id === BlockType.CONDITION
  }

  async execute(
    ctx: ExecutionContext,
    block: SerializedBlock,
    inputs: Record<string, any>
  ): Promise<BlockOutput> {
    const conditions = this.parseConditions(inputs.conditions)

    const baseBlockId = extractBaseBlockId(block.id)
    const branchIndex = isBranchNodeId(block.id) ? extractBranchIndex(block.id) : null

    const sourceConnection = ctx.workflow?.connections.find((conn) => conn.target === baseBlockId)
    let sourceBlockId = sourceConnection?.source

    if (sourceBlockId && branchIndex !== null) {
      const virtualSourceId = buildBranchNodeId(sourceBlockId, branchIndex)
      if (ctx.blockStates.has(virtualSourceId)) {
        sourceBlockId = virtualSourceId
      }
    }

    const evalContext = this.buildEvaluationContext(ctx, sourceBlockId)
    const rawSourceOutput = sourceBlockId ? ctx.blockStates.get(sourceBlockId)?.output : null

    const sourceOutput = this.filterSourceOutput(rawSourceOutput)

    const outgoingConnections = ctx.workflow?.connections.filter(
      (conn) => conn.source === baseBlockId
    )

    const { selectedConnection, selectedCondition } = await this.evaluateConditions(
      conditions,
      outgoingConnections || [],
      evalContext,
      ctx,
      block.id
    )

    if (!selectedCondition) {
      return {
        ...((sourceOutput as any) || {}),
        conditionResult: false,
        selectedPath: null,
        selectedOption: null,
      }
    }

    if (!selectedConnection) {
      const decisionKey = ctx.currentVirtualBlockId || block.id
      ctx.decisions.condition.set(decisionKey, selectedCondition.id)
      return {
        ...((sourceOutput as any) || {}),
        conditionResult: true,
        selectedPath: null,
        selectedOption: selectedCondition.id,
      }
    }

    const targetBlock = ctx.workflow?.blocks.find((b) => b.id === selectedConnection?.target)
    if (!targetBlock) {
      throw new Error(`Target block ${selectedConnection?.target} not found`)
    }

    const decisionKey = ctx.currentVirtualBlockId || block.id
    ctx.decisions.condition.set(decisionKey, selectedCondition.id)

    return {
      ...((sourceOutput as any) || {}),
      conditionResult: true,
      selectedPath: {
        blockId: targetBlock.id,
        blockType: targetBlock.metadata?.id || DEFAULTS.BLOCK_TYPE,
        blockTitle: targetBlock.metadata?.name || DEFAULTS.BLOCK_TITLE,
      },
      selectedOption: selectedCondition.id,
    }
  }

  private filterSourceOutput(output: any): any {
    if (!output || typeof output !== 'object') {
      return output
    }
    const { _pauseMetadata, error, providerTiming, tokens, toolCalls, model, cost, ...rest } =
      output
    return rest
  }

  private parseConditions(input: any): Array<{ id: string; title: string; value: string }> {
    try {
      const conditions = Array.isArray(input) ? input : JSON.parse(input || '[]')
      return conditions
    } catch (error: any) {
      logger.error('Failed to parse conditions', {
        errorName: error?.name,
        inputType: Array.isArray(input) ? 'array' : typeof input,
        inputLength: typeof input === 'string' ? input.length : undefined,
      })
      throw new Error(`Invalid conditions format: ${error.message}`)
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

  private async evaluateConditions(
    conditions: Array<{ id: string; title: string; value: string }>,
    outgoingConnections: Array<{ source: string; target: string; sourceHandle?: string }>,
    evalContext: Record<string, any>,
    ctx: ExecutionContext,
    currentNodeId?: string
  ): Promise<{
    selectedConnection: { target: string; sourceHandle?: string } | null
    selectedCondition: { id: string; title: string; value: string } | null
  }> {
    for (const condition of conditions) {
      if (isElseConditionTitle(condition.title)) {
        const connection = this.findConnectionForCondition(outgoingConnections, condition.id)
        return { selectedConnection: connection ?? null, selectedCondition: condition }
      }

      const conditionValueString = String(condition.value || '')
      try {
        const conditionMet = await evaluateConditionExpression(
          ctx,
          conditionValueString,
          evalContext,
          currentNodeId
        )

        if (conditionMet) {
          const connection = this.findConnectionForCondition(outgoingConnections, condition.id)
          if (connection) {
            return { selectedConnection: connection, selectedCondition: condition }
          }
          return { selectedConnection: null, selectedCondition: condition }
        }
      } catch (error: any) {
        logger.error('Failed to evaluate condition', {
          errorName: error?.name,
          hasTitle: typeof condition.title === 'string' && condition.title.length > 0,
        })
        throw new Error(`Evaluation error in condition "${condition.title}": ${error.message}`)
      }
    }

    return { selectedConnection: null, selectedCondition: null }
  }

  private findConnectionForCondition(
    connections: Array<{ source: string; target: string; sourceHandle?: string }>,
    conditionId: string
  ): { target: string; sourceHandle?: string } | undefined {
    return connections.find(
      (conn) => conn.sourceHandle === `${EDGE.CONDITION_PREFIX}${conditionId}`
    )
  }
}
