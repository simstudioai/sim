import {
  executeCopilotPlatformContextUseCase,
  messageForCopilotPlatformContextError,
} from '@/lib/copilot/application/execute-platform-context-use-case'
import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/request/types'
import { readAccountBilling } from '@/lib/platform-context/application/read-account-billing'

/**
 * Live billing snapshot for the requesting user: plan, current-period usage
 * against its limit, and purchased credit balance. All three sources are
 * org-aware — a member whose subscription lives on an organization gets the
 * org's plan, limit, and credit pool, with `billingScope`/`organizationId`
 * saying which applied.
 */
export async function executeGetAccountBilling(context: ExecutionContext): Promise<ToolCallResult> {
  try {
    const output = await executeCopilotPlatformContextUseCase(context, readAccountBilling, {
      workspaceId: context.workspaceId ?? '',
    })
    return {
      success: true,
      output,
    }
  } catch (error) {
    return { success: false, error: messageForCopilotPlatformContextError(error) }
  }
}
