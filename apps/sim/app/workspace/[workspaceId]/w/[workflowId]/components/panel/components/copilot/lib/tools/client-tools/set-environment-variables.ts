/**
 * Set Environment Variables Tool
 */

import { BaseTool } from '../base-tool'
import type { ToolCall, ToolExecuteResult, ToolMetadata, ToolExecutionOptions } from '../types'

interface SetEnvironmentVariablesParams {
  variables: Record<string, string>
}

export class SetEnvironmentVariablesTool extends BaseTool {
  static readonly id = 'set_environment_variables'

  metadata: ToolMetadata = {
    id: SetEnvironmentVariablesTool.id,
    displayConfig: {
      states: {
        pending: {
          displayName: 'Setting environment variables',
          icon: 'edit'
        },
        executing: {
          displayName: 'Setting environment variables',
          icon: 'loader'
        },
        accepted: {
          displayName: 'Setting environment variables',
          icon: 'edit'
        },
        success: {
          displayName: 'Set environment variables',
          icon: 'check'
        },
        rejected: {
          displayName: 'Skipped setting environment variables',
          icon: 'skip'
        },
        errored: {
          displayName: 'Failed to set environment variables',
          icon: 'error'
        },
        background: {
          displayName: 'Setting environment variables in background',
          icon: 'background'
        }
      },
      // Dynamic display name based on parameters
      getDynamicDisplayName: (state, params: any) => {
        const variables = params.variables as Record<string, string> | undefined
        if (!variables || Object.keys(variables).length === 0) {
          return null // Use default state display name
        }

        const varNames = Object.keys(variables)
        const firstVarName = varNames[0]
        const truncatedName = firstVarName.length > 15 
          ? `${firstVarName.substring(0, 15)}...` 
          : firstVarName
        
        const suffix = varNames.length > 1 
          ? ` (+${varNames.length - 1} more)` 
          : ''

        // Return dynamic names based on state
        switch (state) {
          case 'pending':
          case 'executing':
          case 'accepted':
            return `Setting environment variable ${truncatedName}${suffix}`
          case 'success':
            return `Set environment variable ${truncatedName}${suffix}`
          case 'rejected':
            return `Skipped setting environment variable ${truncatedName}${suffix}`
          case 'errored':
            return `Failed to set environment variable ${truncatedName}${suffix}`
          case 'background':
            return `Setting environment variable ${truncatedName}${suffix} in background`
          default:
            return null
        }
      }
    },
    schema: {
      name: SetEnvironmentVariablesTool.id,
      description: 'Set environment variables for the workflow',
      parameters: {
        type: 'object',
        properties: {
          variables: {
            type: 'object',
            description: 'Key-value pairs of environment variables to set',
            additionalProperties: {
              type: 'string'
            }
          }
        },
        required: ['variables']
      }
    },
    requiresInterrupt: true
  }

  /**
   * Execute the tool - set environment variables
   */
  async execute(toolCall: ToolCall, options?: ToolExecutionOptions): Promise<ToolExecuteResult> {
    try {
      // Extract parameters
      const params = toolCall.parameters as SetEnvironmentVariablesParams
      
      if (!params.variables || Object.keys(params.variables).length === 0) {
        return {
          success: false,
          error: 'No environment variables provided'
        }
      }

      // In a real implementation, this would call an API to set environment variables
      console.log('Setting environment variables:', params.variables)

      // Simulate API call
      const response = await fetch('/api/environment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          variables: params.variables
        })
      })

      if (!response.ok) {
        const error = await response.json()
        return {
          success: false,
          error: error.message || 'Failed to set environment variables'
        }
      }

      const result = await response.json()
      
      return {
        success: true,
        data: {
          variablesSet: Object.keys(params.variables).length,
          variables: params.variables
        }
      }
    } catch (error) {
      console.error('Error setting environment variables:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }
} 