import { getErrorMessage } from '@sim/utils/errors'
import type { z } from 'zod'
import {
  executePostgresqlDelete,
  executePostgresqlInsert,
  executePostgresqlIntrospection,
  executePostgresqlQuery,
  executePostgresqlStatement,
  executePostgresqlUpdate,
  PostgresqlOperationInputError,
} from '@/lib/internal/postgresql/operations'
import {
  postgresqlDeleteInputSchema,
  postgresqlExecuteInputSchema,
  postgresqlInsertInputSchema,
  postgresqlIntrospectInputSchema,
  postgresqlQueryInputSchema,
  postgresqlUpdateInputSchema,
} from '@/lib/internal/postgresql/schema'
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
    if (error instanceof PostgresqlOperationInputError) {
      return Response.json({ error: error.message }, { status: 400 })
    }
    return Response.json(
      { error: `${errorMessage}: ${getErrorMessage(error, 'Unknown error occurred')}` },
      { status: 500 }
    )
  }
}

export const executePostgresqlTool: InternalToolOperationHandler = async ({
  toolId,
  input,
  signal,
}) => {
  signal?.throwIfAborted()

  switch (toolId) {
    case 'postgresql_query':
      return executeOperation(
        postgresqlQueryInputSchema,
        input,
        executePostgresqlQuery,
        'PostgreSQL query failed',
        signal
      )
    case 'postgresql_execute':
      return executeOperation(
        postgresqlExecuteInputSchema,
        input,
        executePostgresqlStatement,
        'PostgreSQL execute failed',
        signal
      )
    case 'postgresql_insert':
      return executeOperation(
        postgresqlInsertInputSchema,
        input,
        executePostgresqlInsert,
        'PostgreSQL insert failed',
        signal
      )
    case 'postgresql_update':
      return executeOperation(
        postgresqlUpdateInputSchema,
        input,
        executePostgresqlUpdate,
        'PostgreSQL update failed',
        signal
      )
    case 'postgresql_delete':
      return executeOperation(
        postgresqlDeleteInputSchema,
        input,
        executePostgresqlDelete,
        'PostgreSQL delete failed',
        signal
      )
    case 'postgresql_introspect':
      return executeOperation(
        postgresqlIntrospectInputSchema,
        input,
        executePostgresqlIntrospection,
        'PostgreSQL introspection failed',
        signal
      )
    default:
      return Response.json({ error: `Unsupported PostgreSQL tool: ${toolId}` }, { status: 500 })
  }
}
