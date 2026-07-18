import type { ToolExecutionContext, ToolExecutionResult } from '@/lib/copilot/tool-executor/types'
import { executeFunctionExecute } from '@/lib/copilot/tools/handlers/function-execute'

/**
 * Compute-only variant of function_execute for info-gathering agents: same
 * sandbox and inputs, but it must never create or overwrite workspace
 * resources. The write vectors (outputs.files, outputTable) are rejected here
 * on top of the Go executor's fail-fast guard; run_code is also absent from
 * the name-gated output post-processors (OUTPUT_PATH_TOOLS etc.), so even a
 * leaked arg could not write anything.
 */
export async function executeRunCode(
  params: Record<string, unknown>,
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  if ('outputs' in params) {
    return {
      success: false,
      error:
        'run_code is compute-only: outputs (workspace file writes) is not available; return the data and report it instead',
    }
  }
  if ('outputTable' in params) {
    return {
      success: false,
      error:
        'run_code is compute-only: outputTable (workspace table overwrite) is not available; return the data and report it instead',
    }
  }
  return executeFunctionExecute(params, context)
}
