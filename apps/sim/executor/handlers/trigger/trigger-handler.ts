import { createLogger } from '@/lib/logs/console/logger'
import type { BlockHandler, ExecutionContext } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'

const logger = createLogger('TriggerBlockHandler')

/**
 * Handler for trigger blocks (Gmail, Webhook, Schedule, etc.)
 * These blocks don't execute tools - they provide input data to workflows
 */
export class TriggerBlockHandler implements BlockHandler {
  canHandle(block: SerializedBlock): boolean {
    // Handle blocks that are triggers - either by category or by having triggerMode enabled
    const isTriggerCategory = block.metadata?.category === 'triggers'

    // For blocks that can be both tools and triggers (like Gmail/Outlook), check if triggerMode is enabled
    // This would come from the serialized block config/params
    const hasTriggerMode = block.config?.params?.triggerMode === true

    return isTriggerCategory || hasTriggerMode
  }

  async execute(
    ctx: ExecutionContext,
    block: SerializedBlock,
    inputs: Record<string, any>
  ): Promise<any> {
    logger.info(`Executing trigger block: ${block.id} (Type: ${block.metadata?.id})`)

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

        // Generic handling for webhook triggers - extract provider-specific data

        // Check if this is a webhook execution
        if (starterOutput.webhook?.data) {
          const webhookData = starterOutput.webhook?.data || {}
          const provider = webhookData.provider

          logger.debug(`Processing webhook trigger for block ${block.id}`, {
            provider,
            blockType: block.metadata?.id,
          })

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

        logger.debug(`Returning starter block output for trigger block ${block.id}`, {
          starterOutputKeys: Object.keys(starterOutput),
        })
        return starterOutput
      }
    }

    if (inputs && Object.keys(inputs).length > 0) {
      logger.debug(`Returning trigger inputs for block ${block.id}`, {
        inputKeys: Object.keys(inputs),
      })
      return inputs
    }

    logger.debug(`No inputs provided for trigger block ${block.id}, returning empty object`)
    return {}
  }
}
