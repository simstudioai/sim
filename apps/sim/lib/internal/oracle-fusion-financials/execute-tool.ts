import { ZodError } from 'zod'
import { OracleFusionProviderError } from '@/lib/internal/oracle-fusion/errors'
import {
  executeOracleFusionFinancialsOperation,
  isOracleFusionFinancialsToolId,
} from '@/lib/internal/oracle-fusion-financials/operations'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

export const executeOracleFusionFinancialsTool: InternalToolOperationHandler = async ({
  toolId,
  input,
  signal,
}) => {
  signal?.throwIfAborted()
  if (!isOracleFusionFinancialsToolId(toolId)) {
    return Response.json(
      { success: false, error: `Unsupported Oracle Fusion Financials tool: ${toolId}` },
      { status: 500 }
    )
  }

  try {
    return Response.json(await executeOracleFusionFinancialsOperation(toolId, input, signal))
  } catch (error) {
    signal?.throwIfAborted()
    if (error instanceof OracleFusionProviderError) {
      return Response.json(
        { success: false, output: {}, error: error.message },
        { status: error.status }
      )
    }
    const validationFailure = error instanceof ZodError
    return Response.json(
      {
        success: false,
        output: {},
        error: validationFailure
          ? 'Invalid Oracle Fusion Financials input'
          : 'Oracle Fusion Financials request failed',
      },
      { status: validationFailure ? 400 : 500 }
    )
  }
}
