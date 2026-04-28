import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/request/types'
import { PLATFORM_ACTIONS_CONTENT } from './platform-actions'

export async function executeGetPlatformActions(
  _rawParams: Record<string, unknown>,
  _context: ExecutionContext
): Promise<ToolCallResult> {
  return { success: true, output: { content: PLATFORM_ACTIONS_CONTENT } }
}
