import { z } from 'zod'
import { OracleFusionProviderError } from '@/lib/internal/oracle-fusion/errors'
import { executeOracleFusionSubscriptionOperation } from '@/lib/internal/oracle-fusion-subscription-management/operations'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'
import {
  getOracleFusionSubscriptionOperation,
  ORACLE_FUSION_SUBSCRIPTION_OPERATIONS,
} from '@/tools/oracle_fusion_subscription_management/shared'

export const executeOracleFusionSubscriptionTool: InternalToolOperationHandler = async ({
  toolId,
  input,
  signal,
}) => {
  signal?.throwIfAborted()
  const prefix = 'oracle_fusion_subscription_management_'
  const name = toolId.startsWith(prefix) ? toolId.slice(prefix.length) : ''
  if (!Object.hasOwn(ORACLE_FUSION_SUBSCRIPTION_OPERATIONS, name)) {
    return Response.json(
      { success: false, error: 'Unsupported Oracle Fusion Subscription Management tool' },
      { status: 500 }
    )
  }
  const operation = getOracleFusionSubscriptionOperation(name)
  const retryable = operation.kind === 'list' || operation.kind === 'get'
  try {
    const result = await executeOracleFusionSubscriptionOperation(name, input, signal)
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
      { success: false, error: 'Oracle Fusion Subscription Management request failed', retryable },
      { status: 500 }
    )
  }
}
