import type { CopilotToolResponse } from '@/lib/copilot/tools/server-tools/base'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('CopilotMethodsUtils')

/**
 * Create a standardized error response
 */
export function createErrorResponse(error: string): CopilotToolResponse {
  return {
    success: false,
    error,
  }
}
