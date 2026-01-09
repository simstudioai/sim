/**
 * Google Vault Block Handler
 *
 * Specialized handler for Google Vault blocks that provides enhanced error
 * messages for credential-related issues specific to Google Vault's
 * administrative requirements.
 */

import { createLogger } from '@sim/logger'
import { getBlock } from '@/blocks/index'
import type { BlockHandler, ExecutionContext } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'
import { executeTool } from '@/tools'
import { getTool } from '@/tools/utils'

const logger = createLogger('GoogleVaultBlockHandler')

/**
 * Detects Google Vault credential/reauthentication errors
 * These can manifest as:
 * - RAPT (reauthentication policy) errors when Google Workspace admin requires reauth
 * - Generic "failed to refresh token" errors which often wrap RAPT errors
 */
function isCredentialRefreshError(errorMessage: string): boolean {
  const lowerMessage = errorMessage.toLowerCase()
  return (
    lowerMessage.includes('invalid_rapt') ||
    lowerMessage.includes('reauth related error') ||
    (lowerMessage.includes('invalid_grant') && lowerMessage.includes('rapt')) ||
    lowerMessage.includes('failed to refresh token') ||
    (lowerMessage.includes('failed to fetch access token') && lowerMessage.includes('401'))
  )
}

/**
 * Enhances error messages for Google Vault credential failures
 * Provides actionable workaround instructions for administrators
 */
function enhanceCredentialError(originalError: string): string {
  if (isCredentialRefreshError(originalError)) {
    return (
      `Google Vault authentication failed (likely due to reauthentication policy). ` +
      `To resolve this, try disconnecting and reconnecting your Google Vault credential ` +
      `in the Credentials settings. If the issue persists, ask your Google Workspace ` +
      `administrator to disable "Reauthentication policy" for Sim Studio in the Google ` +
      `Admin Console (Security > Access and data control > Context-Aware Access > ` +
      `Reauthentication policy), or exempt Sim Studio from reauthentication requirements. ` +
      `Learn more: https://support.google.com/a/answer/9368756`
    )
  }
  return originalError
}

export class GoogleVaultBlockHandler implements BlockHandler {
  canHandle(block: SerializedBlock): boolean {
    return block.metadata?.id === 'google_vault'
  }

  async execute(
    ctx: ExecutionContext,
    block: SerializedBlock,
    inputs: Record<string, any>
  ): Promise<any> {
    const tool = getTool(block.config.tool)
    if (!tool) {
      throw new Error(`Tool not found: ${block.config.tool}`)
    }

    let finalInputs = { ...inputs }

    const blockType = block.metadata?.id
    if (blockType) {
      const blockConfig = getBlock(blockType)
      if (blockConfig?.tools?.config?.params) {
        try {
          const transformedParams = blockConfig.tools.config.params(inputs)
          finalInputs = { ...inputs, ...transformedParams }
        } catch (error) {
          logger.warn(`Failed to apply parameter transformation for block type ${blockType}:`, {
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }

      if (blockConfig?.inputs) {
        for (const [key, inputSchema] of Object.entries(blockConfig.inputs)) {
          const value = finalInputs[key]
          if (typeof value === 'string' && value.trim().length > 0) {
            const inputType = typeof inputSchema === 'object' ? inputSchema.type : inputSchema
            if (inputType === 'json' || inputType === 'array') {
              try {
                finalInputs[key] = JSON.parse(value.trim())
              } catch (error) {
                logger.warn(`Failed to parse ${inputType} field "${key}":`, {
                  error: error instanceof Error ? error.message : String(error),
                })
              }
            }
          }
        }
      }
    }

    try {
      const result = await executeTool(
        block.config.tool,
        {
          ...finalInputs,
          _context: {
            workflowId: ctx.workflowId,
            workspaceId: ctx.workspaceId,
            executionId: ctx.executionId,
          },
        },
        false,
        false,
        ctx
      )

      if (!result.success) {
        const errorDetails = []
        if (result.error) {
          // Enhance credential errors with Google Vault specific guidance
          errorDetails.push(enhanceCredentialError(result.error))
        }

        const errorMessage =
          errorDetails.length > 0
            ? errorDetails.join(' - ')
            : `Block execution of ${tool?.name || block.config.tool} failed with no error message`

        const error = new Error(errorMessage)

        Object.assign(error, {
          toolId: block.config.tool,
          toolName: tool?.name || 'Unknown tool',
          blockId: block.id,
          blockName: block.metadata?.name || 'Unnamed Block',
          output: result.output || {},
          timestamp: new Date().toISOString(),
        })

        throw error
      }

      const output = result.output
      let cost = null

      if (output?.cost) {
        cost = output.cost
      }

      if (cost) {
        return {
          ...output,
          cost: {
            input: cost.input,
            output: cost.output,
            total: cost.total,
          },
          tokens: cost.tokens,
          model: cost.model,
        }
      }

      return output
    } catch (error: any) {
      // Enhance credential errors thrown during tool execution
      if (error instanceof Error) {
        const enhancedMessage = enhanceCredentialError(error.message)
        if (enhancedMessage !== error.message) {
          error.message = enhancedMessage
        }
      }

      if (!error.message || error.message === 'undefined (undefined)') {
        let errorMessage = `Block execution of ${tool?.name || block.config.tool} failed`

        if (block.metadata?.name) {
          errorMessage += `: ${block.metadata.name}`
        }

        if (error.status) {
          errorMessage += ` (Status: ${error.status})`
        }

        error.message = errorMessage
      }

      if (typeof error === 'object' && error !== null) {
        if (!error.toolId) error.toolId = block.config.tool
        if (!error.blockName) error.blockName = block.metadata?.name || 'Unnamed Block'
      }

      throw error
    }
  }
}
