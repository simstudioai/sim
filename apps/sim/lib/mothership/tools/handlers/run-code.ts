import type {
  ToolExecutionContext,
  ToolExecutionResult,
} from '@/lib/mothership/tool-executor/types'
import { executeFunctionExecute } from '@/lib/mothership/tools/handlers/function-execute'

/**
 * run_code returns code output; run_function additionally persists declared
 * outputs through its post-processors. Both allow authenticated CLI scripts,
 * so rejecting persistence parameters here is an API distinction, not a
 * read-only sandbox guarantee.
 */
export async function executeRunCode(
  params: Record<string, unknown>,
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  if ('outputs' in params) {
    return {
      success: false,
      error:
        'run_code returns code output. Use run_function with outputs.files to export sandbox files into the workspace.',
    }
  }
  if ('outputTable' in params) {
    return {
      success: false,
      error:
        'run_code returns code output. Use run_function with outputTable to replace a workspace table with returned rows.',
    }
  }
  return executeFunctionExecute(params, context)
}
