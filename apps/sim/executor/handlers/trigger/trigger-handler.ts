import { createLogger } from '@sim/logger'
import { BlockType, isTriggerBehavior, isTriggerInternalKey } from '@/executor/constants'
import type { BlockHandler, ExecutionContext } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'

const logger = createLogger('TriggerBlockHandler')

export class TriggerBlockHandler implements BlockHandler {
  canHandle(block: SerializedBlock): boolean {
    return isTriggerBehavior(block)
  }

  async execute(
    ctx: ExecutionContext,
    block: SerializedBlock,
    inputs: Record<string, any>
  ): Promise<any> {
    logger.info(`Executing trigger block: ${block.id} (Type: ${block.metadata?.id})`)

    if (block.metadata?.id === BlockType.STARTER) {
      return this.executeStarterBlock(ctx, block, inputs)
    }

    const existingState = ctx.blockStates.get(block.id)
    if (existingState?.output && Object.keys(existingState.output).length > 0) {
      return existingState.output
    }

    const starterBlock = ctx.workflow?.blocks?.find((b) => b.metadata?.id === 'starter')
    if (starterBlock) {
      const starterState = ctx.blockStates.get(starterBlock.id)
      if (starterState?.output && Object.keys(starterState.output).length > 0) {
        const starterOutput = starterState.output

        if (starterOutput.webhook?.data) {
          const cleanOutput: Record<string, unknown> = {}
          for (const [key, value] of Object.entries(starterOutput)) {
            if (!isTriggerInternalKey(key)) {
              cleanOutput[key] = value
            }
          }
          return cleanOutput
        }

        return starterOutput
      }
    }

    if (inputs && Object.keys(inputs).length > 0) {
      return inputs
    }

    return {}
  }

  private executeStarterBlock(
    ctx: ExecutionContext,
    block: SerializedBlock,
    inputs: Record<string, any>
  ): any {
    logger.info(`Executing starter block: ${block.id}`, {
      blockName: block.metadata?.name,
    })

    const existingState = ctx.blockStates.get(block.id)
    if (existingState?.output && Object.keys(existingState.output).length > 0) {
      return existingState.output
    }

    logger.warn('Starter block output not found in context, returning empty output', {
      blockId: block.id,
    })

    return {
      input: inputs.input || '',
    }
  }
}
