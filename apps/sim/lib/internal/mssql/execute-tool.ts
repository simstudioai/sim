import { getErrorMessage } from '@sim/utils/errors'
import type { z } from 'zod'
import {
  executeMssqlDelete,
  executeMssqlInsert,
  executeMssqlIntrospection,
  executeMssqlQuery,
  executeMssqlStatement,
  executeMssqlUpdate,
  MssqlOperationInputError,
} from '@/lib/internal/mssql/operations'
import {
  mssqlDeleteInputSchema,
  mssqlExecuteInputSchema,
  mssqlInsertInputSchema,
  mssqlIntrospectInputSchema,
  mssqlQueryInputSchema,
  mssqlUpdateInputSchema,
} from '@/lib/internal/mssql/schema'
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
    if (error instanceof MssqlOperationInputError) {
      return Response.json({ error: error.message }, { status: 400 })
    }
    return Response.json(
      { error: `${errorMessage}: ${getErrorMessage(error, 'Unknown error occurred')}` },
      { status: 500 }
    )
  }
}

export const executeMssqlTool: InternalToolOperationHandler = async ({ toolId, input, signal }) => {
  signal?.throwIfAborted()

  switch (toolId) {
    case 'mssql_query':
      return executeOperation(
        mssqlQueryInputSchema,
        input,
        executeMssqlQuery,
        'Microsoft SQL Server query failed',
        signal
      )
    case 'mssql_execute':
      return executeOperation(
        mssqlExecuteInputSchema,
        input,
        executeMssqlStatement,
        'Microsoft SQL Server execute failed',
        signal
      )
    case 'mssql_insert':
      return executeOperation(
        mssqlInsertInputSchema,
        input,
        executeMssqlInsert,
        'Microsoft SQL Server insert failed',
        signal
      )
    case 'mssql_update':
      return executeOperation(
        mssqlUpdateInputSchema,
        input,
        executeMssqlUpdate,
        'Microsoft SQL Server update failed',
        signal
      )
    case 'mssql_delete':
      return executeOperation(
        mssqlDeleteInputSchema,
        input,
        executeMssqlDelete,
        'Microsoft SQL Server delete failed',
        signal
      )
    case 'mssql_introspect':
      return executeOperation(
        mssqlIntrospectInputSchema,
        input,
        executeMssqlIntrospection,
        'Microsoft SQL Server introspection failed',
        signal
      )
    default:
      return Response.json(
        { error: `Unsupported Microsoft SQL Server tool: ${toolId}` },
        { status: 500 }
      )
  }
}
