import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { executeAgentCliRequest } from '@/lib/mothership/agent-cli'
import { messageForCopilotApplicationError } from '@/lib/mothership/application/error'
import { AgentCliRequest } from '@/lib/mothership/generated/agent-cli'
import type {
  ToolExecutionContext,
  ToolExecutionResult,
} from '@/lib/mothership/tool-executor/types'

const logger = createLogger('MothershipSimCli')

/**
 * The worker's `sim_cli` tool defers here. The frame carries the worker's typed request
 * (`request`) beside the model's raw argv (`args`, kept for display and the log); only
 * the request is executed — this side never re-parses tokens. The worker folds
 * exitCode/stdout/stderr into the model window and applies its own output budget.
 */
export async function executeSimCli(
  params: Record<string, unknown>,
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const parsed = AgentCliRequest.safeParse(params.request)
  if (!parsed.success) {
    return {
      success: false,
      error: 'sim_cli requires the worker-built request; the invocation was not translated.',
    }
  }
  if (!context.workspaceId && !context.organizationId) {
    return { success: false, error: 'sim_cli requires a workspace-scoped execution context.' }
  }
  try {
    const result = await executeAgentCliRequest(parsed.data, {
      workspaceId: context.workspaceId,
      organizationId: context.organizationId,
      chatOrganizationId: context.chatOrganizationId,
      userId: context.userId,
      chatId: context.chatId,
      signal: context.abortSignal,
      toolCallId: context.toolCallId,
      copilotToolExecution: context.copilotToolExecution,
      requestMode: context.requestMode,
      searchSurface: context.searchSurface,
      assistantSearch: context.assistantSearch,
      billingAttribution: context.billingAttribution,
      executionId: context.executionId,
      messageId: context.messageId,
      parentToolCallId: context.parentToolCallId,
      userPermission: context.userPermission,
      resolvedSecretTraceRegistry: context.resolvedSecretTraceRegistry,
    })
    logger.info('CLI invocation finished', {
      exitCode: result.exitCode,
      lane: parsed.data.invocation.kind,
      sink: parsed.data.sink?.kind ?? 'none',
      stdoutBytes: result.stdout.length,
    })
    return {
      success: result.exitCode === 0,
      output: result,
      ...(result.exitCode === 0
        ? {}
        : { error: result.stderr.split('\n')[0] || `sim CLI exited with code ${result.exitCode}` }),
    }
  } catch (error) {
    return {
      success: false,
      error:
        parsed.data.invocation.kind === 'service' || parsed.data.invocation.kind === 'stdout'
          ? messageForCopilotApplicationError(error)
          : getErrorMessage(error),
    }
  }
}
