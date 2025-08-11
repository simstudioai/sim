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
    block: SerializedBlock,
    inputs: Record<string, any>,
    context: ExecutionContext
  ): Promise<any> {
    logger.info(`Executing trigger block: ${block.id} (Type: ${block.metadata?.id})`)

    // For trigger blocks, return the starter block's output which contains the workflow input
    // This ensures webhook data like message, sender, chat, etc. are accessible
    const starterBlock = context.workflow?.blocks?.find((b) => b.metadata?.id === 'starter')
    if (starterBlock) {
      const starterState = context.blockStates.get(starterBlock.id)
      if (starterState?.output && Object.keys(starterState.output).length > 0) {
        const starterOutput = starterState.output

        // Generic handling for webhook triggers - extract provider-specific data
        // Check if this is a webhook execution with nested structure
        if (starterOutput.webhook?.data) {
          const webhookData = starterOutput.webhook.data
          const provider = webhookData.provider

          logger.debug(`Processing webhook trigger for block ${block.id}`, {
            provider,
            blockType: block.metadata?.id,
          })

          // Extract the flattened properties that should be at root level
          const result: any = {
            // Always keep the input at root level
            input: starterOutput.input,
          }

          // FIRST: Copy all existing top-level properties (like 'event', 'message', etc.)
          // This ensures that properties already flattened in webhook utils are preserved
          for (const [key, value] of Object.entries(starterOutput)) {
            if (key !== 'webhook' && key !== provider) {
              result[key] = value
            }
          }

          // SECOND: Generic extraction logic based on common webhook patterns
          // Pattern 1: Provider-specific nested object (telegram, microsoftteams, etc.)
          if (provider && starterOutput[provider]) {
            // Copy all properties from provider object to root level for direct access
            const providerData = starterOutput[provider]
            
            // Enhanced debug logging for GitHub provider
            if (provider === 'github') {
              logger.debug(`Processing GitHub webhook data for block ${block.id}`, {
                providerDataKeys: Object.keys(providerData),
                hasRepository: 'repository' in providerData,
                repositoryType: typeof providerData.repository,
                repositoryKeys: providerData.repository ? Object.keys(providerData.repository) : [],
                hasRef: 'ref' in providerData,
                hasBefore: 'before' in providerData,
                hasAfter: 'after' in providerData,
              })
            }
            
            for (const [key, value] of Object.entries(providerData)) {
              // Special handling for GitHub provider - copy all properties
              if (provider === 'github') {
                // For GitHub, copy all properties (objects and primitives) to root level
                if (!result[key]) {
                  result[key] = value
                }
              } else {
                // For other providers, keep existing logic (only copy objects)
                if (typeof value === 'object' && value !== null) {
                  // Don't overwrite existing top-level properties
                  if (!result[key]) {
                    result[key] = value
                  }
                }
              }
            }

            // Keep nested structure for backwards compatibility
            result[provider] = providerData
            
            // Final verification for GitHub
            if (provider === 'github') {
              logger.debug(`GitHub trigger result after processing`, {
                resultKeys: Object.keys(result),
                hasRepository: 'repository' in result,
                repositoryType: typeof result.repository,
                hasRef: 'ref' in result,
                hasBefore: 'before' in result,
                hasAfter: 'after' in result,
              })
            }
          }

          // Pattern 2: Provider data directly in webhook.data (based on actual structure)
          else if (provider && webhookData[provider]) {
            const providerData = webhookData[provider]

            // Extract all provider properties to root level
            for (const [key, value] of Object.entries(providerData)) {
              if (typeof value === 'object' && value !== null) {
                // Don't overwrite existing top-level properties
                if (!result[key]) {
                  result[key] = value
                }
              }
            }

            // Keep nested structure for backwards compatibility
            result[provider] = providerData
          }

          // Pattern 3: Email providers with data in webhook.data.payload.email (Gmail, Outlook)
          else if (
            provider &&
            (provider === 'gmail' || provider === 'outlook') &&
            webhookData.payload?.email
          ) {
            const emailData = webhookData.payload.email

            // Flatten email fields to root level for direct access
            for (const [key, value] of Object.entries(emailData)) {
              if (!result[key]) {
                result[key] = value
              }
            }

            // Keep the email object for backwards compatibility
            result.email = emailData

            // Also keep timestamp if present in payload
            if (webhookData.payload.timestamp) {
              result.timestamp = webhookData.payload.timestamp
            }
          }

          // Always keep webhook metadata
          if (starterOutput.webhook) result.webhook = starterOutput.webhook

          logger.debug(`Processed webhook data for trigger block ${block.id}`, {
            provider,
            resultKeys: Object.keys(result),
            hasMessage: !!result.message,
            hasEvent: !!result.event,
            hasText: !!result.text,
            textValue: result.text,
          })

          return result
        }

        logger.debug(`Returning starter block output for trigger block ${block.id}`, {
          starterOutputKeys: Object.keys(starterOutput),
        })
        return starterOutput
      }
    }

    // Fallback to resolved inputs if no starter block output
    if (inputs && Object.keys(inputs).length > 0) {
      logger.debug(`Returning trigger inputs for block ${block.id}`, {
        inputKeys: Object.keys(inputs),
      })
      return inputs
    }

    // Fallback - return empty object for trigger blocks with no inputs
    logger.debug(`No inputs provided for trigger block ${block.id}, returning empty object`)
    return {}
  }
}
