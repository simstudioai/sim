import { getErrorMessage } from '@sim/utils/errors'
import type { z } from 'zod'
import {
  executeRdsDelete,
  executeRdsInsert,
  executeRdsIntrospection,
  executeRdsQuery,
  executeRdsStatement,
  executeRdsUpdate,
  RdsOperationInputError,
} from '@/lib/internal/rds/operations'
import {
  rdsDeleteInputSchema,
  rdsExecuteInputSchema,
  rdsInsertInputSchema,
  rdsIntrospectInputSchema,
  rdsQueryInputSchema,
  rdsUpdateInputSchema,
} from '@/lib/internal/rds/schema'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

async function executeOperation<TInput>(
  schema: z.ZodType<TInput>,
  input: unknown,
  execute: (input: TInput, signal?: AbortSignal) => Promise<unknown>,
  errorMessage: string,
  signal?: AbortSignal
): Promise<Response> {
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    return Response.json(
      { error: 'Invalid request data', details: parsed.error.issues },
      { status: 400 }
    )
  }

  try {
    const result = await execute(parsed.data, signal)
    signal?.throwIfAborted()
    return Response.json(result)
  } catch (error) {
    signal?.throwIfAborted()
    if (error instanceof RdsOperationInputError) {
      return Response.json({ error: error.message }, { status: 400 })
    }
    return Response.json(
      { error: `${errorMessage}: ${getErrorMessage(error, 'Unknown error occurred')}` },
      { status: 500 }
    )
  }
}

export const executeRdsTool: InternalToolOperationHandler = async ({ toolId, input, signal }) => {
  signal?.throwIfAborted()

  switch (toolId) {
    case 'rds_query':
      return executeOperation(
        rdsQueryInputSchema,
        input,
        executeRdsQuery,
        'RDS query failed',
        signal
      )
    case 'rds_execute':
      return executeOperation(
        rdsExecuteInputSchema,
        input,
        executeRdsStatement,
        'RDS execute failed',
        signal
      )
    case 'rds_insert':
      return executeOperation(
        rdsInsertInputSchema,
        input,
        executeRdsInsert,
        'RDS insert failed',
        signal
      )
    case 'rds_update':
      return executeOperation(
        rdsUpdateInputSchema,
        input,
        executeRdsUpdate,
        'RDS update failed',
        signal
      )
    case 'rds_delete':
      return executeOperation(
        rdsDeleteInputSchema,
        input,
        executeRdsDelete,
        'RDS delete failed',
        signal
      )
    case 'rds_introspect':
      return executeOperation(
        rdsIntrospectInputSchema,
        input,
        executeRdsIntrospection,
        'RDS introspection failed',
        signal
      )
    default:
      return Response.json({ error: `Unsupported RDS tool: ${toolId}` }, { status: 500 })
  }
}
