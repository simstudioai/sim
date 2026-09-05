import { OracleFusionProviderError } from '@/lib/internal/oracle-fusion/errors'
import { executeOracleFusionServiceOperation } from '@/lib/internal/oracle-fusion-service/operations'
import { isOracleFusionServiceToolId } from '@/lib/internal/oracle-fusion-service/schema'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

export const executeOracleFusionServiceTool: InternalToolOperationHandler = async ({
  toolId,
  input,
  signal,
}) => {
  signal?.throwIfAborted()
  if (!isOracleFusionServiceToolId(toolId)) {
    return Response.json(
      { success: false, output: {}, error: 'Unsupported Oracle Fusion Service tool' },
      { status: 500 }
    )
  }
  try {
    return Response.json(await executeOracleFusionServiceOperation(toolId, input, signal))
  } catch (error) {
    signal?.throwIfAborted()
    if (error instanceof OracleFusionProviderError) {
      return Response.json(
        { success: false, output: {}, error: error.message },
        { status: error.status }
      )
    }
    const invalidInput = error instanceof Error && error.name === 'ZodError'
    return Response.json(
      {
        success: false,
        output: {},
        error: invalidInput
          ? 'Invalid Oracle Fusion Service input'
          : 'Oracle Fusion Service request failed',
      },
      { status: invalidInput ? 400 : 500 }
    )
  }
}
