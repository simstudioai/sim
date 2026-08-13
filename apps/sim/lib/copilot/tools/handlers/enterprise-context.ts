import {
  executeCopilotPlatformContextUseCase,
  messageForCopilotPlatformContextError,
} from '@/lib/copilot/application/execute-platform-context-use-case'
import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/request/types'
import { readEnterpriseContext } from '@/lib/platform-context/application/read-enterprise-context'

/**
 * Resolves the authenticated user's effective Enterprise access in the current
 * workspace. This is an explanatory snapshot; every later mutation must still
 * perform its normal server-side authorization at execution time.
 */
export async function executeGetEnterpriseContext(
  context: ExecutionContext
): Promise<ToolCallResult> {
  if (!context.workspaceId) {
    return {
      success: false,
      error: 'A current workspace is required to resolve enterprise access.',
    }
  }

  try {
    const output = await executeCopilotPlatformContextUseCase(context, readEnterpriseContext, {
      workspaceId: context.workspaceId,
    })
    return {
      success: true,
      output,
    }
  } catch (error) {
    return { success: false, error: messageForCopilotPlatformContextError(error) }
  }
}
