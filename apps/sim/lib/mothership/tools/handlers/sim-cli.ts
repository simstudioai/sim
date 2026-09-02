import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { executeAgentCliRequest } from '@/lib/mothership/agent-cli'
import { agentCliRequestSchema } from '@/lib/mothership/agent-cli/request-schema'
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
  const parsed = agentCliRequestSchema.safeParse(params.request)
  if (!parsed.success) {
    return {
      success: false,
      error: 'sim_cli requires the worker-built request; the invocation was not translated.',
    }
  }
  if (!context.workspaceId) {
    return { success: false, error: 'sim_cli requires a workspace-scoped execution context.' }
  }
  try {
    const result = await executeAgentCliRequest(parsed.data, {
      workspaceId: context.workspaceId,
      userId: context.userId,
      chatId: context.chatId,
    })
    logger.info('CLI invocation finished', {
      exitCode: result.exitCode,
      lane: parsed.data.invocation.kind,
      pipeStages: parsed.data.pipeline.length,
      stdoutBytes: result.stdout.length,
    })
    return {
      success: result.exitCode === 0,
      output: { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr },
      ...(result.exitCode === 0
        ? {}
        : { error: result.stderr.split('\n')[0] || `sim CLI exited with code ${result.exitCode}` }),
    }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) }
  }
}
