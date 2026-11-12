import { getErrorMessage } from '@sim/utils/errors'
import type { z } from 'zod'
import { withSavedDatabaseConnection } from '@/lib/credentials/database-connections/server'
import {
  executeMysqlDelete,
  executeMysqlInsert,
  executeMysqlIntrospection,
  executeMysqlQuery,
  executeMysqlStatement,
  executeMysqlUpdate,
  MysqlOperationInputError,
} from '@/lib/internal/mysql/operations'
import {
  mysqlDeleteInputSchema,
  mysqlExecuteInputSchema,
  mysqlInsertInputSchema,
  mysqlIntrospectInputSchema,
  mysqlQueryInputSchema,
  mysqlUpdateInputSchema,
} from '@/lib/internal/mysql/schema'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'
import { MYSQL_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/oauth/types'

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
    if (error instanceof MysqlOperationInputError) {
      return Response.json({ error: error.message }, { status: 400 })
    }
    return Response.json(
      { error: `${errorMessage}: ${getErrorMessage(error, 'Unknown error occurred')}` },
      { status: 500 }
    )
  }
}

const runMysqlTool: InternalToolOperationHandler = async ({ toolId, input, signal }) => {
  signal?.throwIfAborted()

  switch (toolId) {
    case 'mysql_query':
      return executeOperation(
        mysqlQueryInputSchema,
        input,
        executeMysqlQuery,
        'MySQL query failed',
        signal
      )
    case 'mysql_execute':
      return executeOperation(
        mysqlExecuteInputSchema,
        input,
        executeMysqlStatement,
        'MySQL execute failed',
        signal
      )
    case 'mysql_insert':
      return executeOperation(
        mysqlInsertInputSchema,
        input,
        executeMysqlInsert,
        'MySQL insert failed',
        signal
      )
    case 'mysql_update':
      return executeOperation(
        mysqlUpdateInputSchema,
        input,
        executeMysqlUpdate,
        'MySQL update failed',
        signal
      )
    case 'mysql_delete':
      return executeOperation(
        mysqlDeleteInputSchema,
        input,
        executeMysqlDelete,
        'MySQL delete failed',
        signal
      )
    case 'mysql_introspect':
      return executeOperation(
        mysqlIntrospectInputSchema,
        input,
        executeMysqlIntrospection,
        'MySQL introspection failed',
        signal
      )
    default:
      return Response.json({ error: `Unsupported MySQL tool: ${toolId}` }, { status: 500 })
  }
}

/** Runs a MySQL tool on its inline connection, or on the saved connection the executor authorized. */
export const executeMysqlTool = withSavedDatabaseConnection(
  MYSQL_SERVICE_ACCOUNT_PROVIDER_ID,
  runMysqlTool
)
