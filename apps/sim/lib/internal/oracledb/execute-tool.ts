import { getErrorMessage } from '@sim/utils/errors'
import type { z } from 'zod'
import {
  executeOracleDelete,
  executeOracleInsert,
  executeOracleIntrospection,
  executeOracleQuery,
  executeOracleStatement,
  executeOracleUpdate,
  OracleOperationInputError,
} from '@/lib/internal/oracledb/operations'
import {
  oracleDeleteInputSchema,
  oracleExecuteInputSchema,
  oracleInsertInputSchema,
  oracleIntrospectInputSchema,
  oracleQueryInputSchema,
  oracleUpdateInputSchema,
} from '@/lib/internal/oracledb/schema'
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
    if (error instanceof OracleOperationInputError) {
      return Response.json({ error: error.message }, { status: 400 })
    }
    return Response.json(
      { error: `${errorMessage}: ${getErrorMessage(error, 'Unknown error occurred')}` },
      { status: 500 }
    )
  }
}

export const executeOracledbTool: InternalToolOperationHandler = async ({
  toolId,
  input,
  signal,
}) => {
  signal?.throwIfAborted()

  switch (toolId) {
    case 'oracledb_query':
      return executeOperation(
        oracleQueryInputSchema,
        input,
        executeOracleQuery,
        'Oracle Database query failed',
        signal
      )
    case 'oracledb_execute':
      return executeOperation(
        oracleExecuteInputSchema,
        input,
        executeOracleStatement,
        'Oracle Database execute failed',
        signal
      )
    case 'oracledb_insert':
      return executeOperation(
        oracleInsertInputSchema,
        input,
        executeOracleInsert,
        'Oracle Database insert failed',
        signal
      )
    case 'oracledb_update':
      return executeOperation(
        oracleUpdateInputSchema,
        input,
        executeOracleUpdate,
        'Oracle Database update failed',
        signal
      )
    case 'oracledb_delete':
      return executeOperation(
        oracleDeleteInputSchema,
        input,
        executeOracleDelete,
        'Oracle Database delete failed',
        signal
      )
    case 'oracledb_introspect':
      return executeOperation(
        oracleIntrospectInputSchema,
        input,
        executeOracleIntrospection,
        'Oracle Database introspection failed',
        signal
      )
    default:
      return Response.json(
        { error: `Unsupported Oracle Database tool: ${toolId}` },
        { status: 500 }
      )
  }
}
