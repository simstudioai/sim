import { createLogger } from '@/lib/logs/console/logger'
import type { CopilotToolResponse } from '../tools/base'

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

/**
 * Create a standardized success response
 */
export function createSuccessResponse(data: any): CopilotToolResponse {
  return {
    success: true,
    data,
  }
}
