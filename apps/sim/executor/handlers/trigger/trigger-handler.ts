import { createLogger } from '@/lib/logs/console/logger'
import { BlockType } from '@/executor/consts'
import type { BlockHandler, ExecutionContext } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'

const logger = createLogger('TriggerBlockHandler')

export class TriggerBlockHandler implements BlockHandler {
  canHandle(block: SerializedBlock): boolean {
    if (block.metadata?.id === BlockType.STARTER) {
      return true
    }

    const isTriggerCategory = block.metadata?.category === 'triggers'

    const hasTriggerMode = block.config?.params?.triggerMode === true

    return isTriggerCategory || hasTriggerMode
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
      const existingOutput = existingState.output as any
      const existingProvider = existingOutput?.webhook?.data?.provider

      return existingOutput
    }

    const starterBlock = ctx.workflow?.blocks?.find((b) => b.metadata?.id === 'starter')
    if (starterBlock) {
      const starterState = ctx.blockStates.get(starterBlock.id)
      if (starterState?.output && Object.keys(starterState.output).length > 0) {
        const starterOutput = starterState.output

        if (starterOutput.webhook?.data) {
          const webhookData = starterOutput.webhook?.data || {}
          const provider = webhookData.provider

          if (provider === 'github') {
            const payloadSource = webhookData.payload || {}
            return {
              ...payloadSource,
              webhook: starterOutput.webhook,
            }
          }

          if (provider === 'microsoftteams') {
            const providerData = (starterOutput as any)[provider] || webhookData[provider] || {}
            const payloadSource = providerData?.message?.raw || webhookData.payload || {}
            return {
              ...payloadSource,
              [provider]: providerData,
              webhook: starterOutput.webhook,
            }
          }

          if (provider === 'airtable') {
            return starterOutput
          }

          const result: any = {
            input: starterOutput.input,
          }

          for (const [key, value] of Object.entries(starterOutput)) {
            if (key !== 'webhook' && key !== provider) {
              result[key] = value
            }
          }

          if (provider && starterOutput[provider]) {
            const providerData = starterOutput[provider]

            for (const [key, value] of Object.entries(providerData)) {
              if (typeof value === 'object' && value !== null) {
                if (!result[key]) {
                  result[key] = value
                }
              }
            }

            result[provider] = providerData
          } else if (provider && webhookData[provider]) {
            const providerData = webhookData[provider]

            for (const [key, value] of Object.entries(providerData)) {
              if (typeof value === 'object' && value !== null) {
                if (!result[key]) {
                  result[key] = value
                }
              }
            }

            result[provider] = providerData
          } else if (
            provider &&
            (provider === 'gmail' || provider === 'outlook') &&
            webhookData.payload?.email
          ) {
            const emailData = webhookData.payload.email

            for (const [key, value] of Object.entries(emailData)) {
              if (!result[key]) {
                result[key] = value
              }
            }

            result.email = emailData

            if (webhookData.payload.timestamp) {
              result.timestamp = webhookData.payload.timestamp
            }
          }

          if (starterOutput.webhook) result.webhook = starterOutput.webhook

          return result
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
