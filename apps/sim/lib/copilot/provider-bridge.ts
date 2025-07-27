/**
 * Bridge for providers to execute copilot tools without importing server-side dependencies
 */

import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('CopilotProviderBridge')

/**
 * Execute a copilot tool and return in ToolResponse format for providers
 * This function avoids importing server-side dependencies by making an HTTP request
 */
export async function executeCopilotToolForProvider(
  toolId: string,
  params: Record<string, any>
): Promise<any> {
  try {
    // Make an HTTP request to execute the copilot tool
    const response = await fetch(
      `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/copilot/execute-tool`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          toolId,
          params,
        }),
      }
    )

    if (!response.ok) {
      return {
        success: false,
        error: `Tool execution failed: ${response.status} ${response.statusText}`,
      }
    }

    const result = await response.json()
    return {
      success: result.success,
      output: result.data,
      error: result.error,
    }
  } catch (error) {
    logger.error(`Copilot tool execution failed: ${toolId}`, error)
    return {
      success: false,
      error: `Tool execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    }
  }
} 