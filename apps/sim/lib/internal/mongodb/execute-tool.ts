import { getErrorMessage } from '@sim/utils/errors'
import type { z } from 'zod'
import {
  executeMongodbAggregation,
  executeMongodbDelete,
  executeMongodbInsert,
  executeMongodbIntrospection,
  executeMongodbQuery,
  executeMongodbUpdate,
  MongodbOperationInputError,
} from '@/lib/internal/mongodb/operations'
import {
  mongodbDeleteInputSchema,
  mongodbExecuteInputSchema,
  mongodbInsertInputSchema,
  mongodbIntrospectInputSchema,
  mongodbQueryInputSchema,
  mongodbUpdateInputSchema,
} from '@/lib/internal/mongodb/schema'
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
    if (error instanceof MongodbOperationInputError) {
      return Response.json({ error: error.message }, { status: 400 })
    }
    return Response.json(
      { error: `${errorMessage}: ${getErrorMessage(error, 'Unknown error occurred')}` },
      { status: 500 }
    )
  }
}

export const executeMongodbTool: InternalToolOperationHandler = async ({
  toolId,
  input,
  signal,
}) => {
  signal?.throwIfAborted()

  switch (toolId) {
    case 'mongodb_query':
      return executeOperation(
        mongodbQueryInputSchema,
        input,
        executeMongodbQuery,
        'MongoDB query failed',
        signal
      )
    case 'mongodb_execute':
      return executeOperation(
        mongodbExecuteInputSchema,
        input,
        executeMongodbAggregation,
        'MongoDB aggregation failed',
        signal
      )
    case 'mongodb_insert':
      return executeOperation(
        mongodbInsertInputSchema,
        input,
        executeMongodbInsert,
        'MongoDB insert failed',
        signal
      )
    case 'mongodb_update':
      return executeOperation(
        mongodbUpdateInputSchema,
        input,
        executeMongodbUpdate,
        'MongoDB update failed',
        signal
      )
    case 'mongodb_delete':
      return executeOperation(
        mongodbDeleteInputSchema,
        input,
        executeMongodbDelete,
        'MongoDB delete failed',
        signal
      )
    case 'mongodb_introspect':
      return executeOperation(
        mongodbIntrospectInputSchema,
        input,
        executeMongodbIntrospection,
        'MongoDB introspect failed',
        signal
      )
    default:
      return Response.json({ error: `Unsupported MongoDB tool: ${toolId}` }, { status: 500 })
  }
}
