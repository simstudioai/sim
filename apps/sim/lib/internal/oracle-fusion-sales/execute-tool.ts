import { z } from 'zod'
import { OracleFusionProviderError } from '@/lib/internal/oracle-fusion/errors'
import { executeOracleFusionSalesOperation } from '@/lib/internal/oracle-fusion-sales/operations'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'
import {
  getOracleFusionSalesOperation,
  ORACLE_FUSION_SALES_OPERATIONS,
} from '@/tools/oracle_fusion_sales/shared'

export const executeOracleFusionSalesTool: InternalToolOperationHandler = async ({
  toolId,
  input,
  signal,
}) => {
  signal?.throwIfAborted()
  const prefix = 'oracle_fusion_sales_'
  const name = toolId.startsWith(prefix) ? toolId.slice(prefix.length) : ''
  if (!Object.hasOwn(ORACLE_FUSION_SALES_OPERATIONS, name)) {
    return Response.json(
      { success: false, error: 'Unsupported Oracle Fusion Sales tool' },
      { status: 500 }
    )
  }
  const operation = getOracleFusionSalesOperation(name)
  const retryable = operation.kind === 'list' || operation.kind === 'get'
  try {
    const result = await executeOracleFusionSalesOperation(name, input, signal)
    signal?.throwIfAborted()
    return Response.json(result)
  } catch (error) {
    signal?.throwIfAborted()
    if (error instanceof z.ZodError) {
      return Response.json(
        {
          success: false,
          error: error.issues
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join('; '),
          retryable: false,
        },
        { status: 400 }
      )
    }
    if (error instanceof OracleFusionProviderError) {
      return Response.json(
        { success: false, error: error.message, retryable },
        { status: error.status }
      )
    }
    return Response.json(
      { success: false, error: 'Oracle Fusion Sales request failed', retryable },
      { status: 500 }
    )
  }
}
