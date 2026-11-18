import { createPostgresClient, type PostgresClient } from '@/lib/internal/postgresql/client'
import {
  deletePostgresRows,
  insertPostgresRows,
  introspectPostgresSchema,
  queryPostgres,
  updatePostgresRows,
  validatePostgresQuery,
} from '@/lib/internal/postgresql/queries'
import type {
  PostgresqlDeleteInput,
  PostgresqlExecuteInput,
  PostgresqlInsertInput,
  PostgresqlIntrospectInput,
  PostgresqlQueryInput,
  PostgresqlUpdateInput,
} from '@/lib/internal/postgresql/schema'
import { toRowsResponseBody } from '@/lib/internal/tool-operations/response-limits'
import type { PostgresConnectionConfig } from '@/tools/postgresql/types'

export class PostgresqlOperationInputError extends Error {}

async function withPostgresClient<TResult>(
  input: PostgresConnectionConfig,
  signal: AbortSignal | undefined,
  execute: (client: PostgresClient) => Promise<TResult>
): Promise<TResult> {
  const client = await createPostgresClient(input, signal)
  try {
    return await execute(client)
  } finally {
    await client.end()
  }
}

export function executePostgresqlQuery(input: PostgresqlQueryInput, signal?: AbortSignal) {
  return withPostgresClient(input, signal, async (client) => {
    const result = await queryPostgres(client, input.query, [], signal)
    return toRowsResponseBody(
      result,
      `Query executed successfully. ${result.rowCount} row(s) returned.`
    )
  })
}

export function executePostgresqlStatement(input: PostgresqlExecuteInput, signal?: AbortSignal) {
  const validation = validatePostgresQuery(input.query)
  if (!validation.isValid) {
    throw new PostgresqlOperationInputError(
      `Query validation failed: ${validation.error ?? 'Invalid query'}`
    )
  }

  return withPostgresClient(input, signal, async (client) => {
    const result = await queryPostgres(client, input.query, [], signal)
    return toRowsResponseBody(
      result,
      `SQL executed successfully. ${result.rowCount} row(s) affected.`
    )
  })
}

export function executePostgresqlInsert(input: PostgresqlInsertInput, signal?: AbortSignal) {
  return withPostgresClient(input, signal, async (client) => {
    const result = await insertPostgresRows(client, input.table, input.data, signal)
    return toRowsResponseBody(
      result,
      `Data inserted successfully. ${result.rowCount} row(s) affected.`
    )
  })
}

export function executePostgresqlUpdate(input: PostgresqlUpdateInput, signal?: AbortSignal) {
  return withPostgresClient(input, signal, async (client) => {
    const result = await updatePostgresRows(client, input.table, input.data, input.where, signal)
    return toRowsResponseBody(
      result,
      `Data updated successfully. ${result.rowCount} row(s) affected.`
    )
  })
}

export function executePostgresqlDelete(input: PostgresqlDeleteInput, signal?: AbortSignal) {
  return withPostgresClient(input, signal, async (client) => {
    const result = await deletePostgresRows(client, input.table, input.where, signal)
    return toRowsResponseBody(
      result,
      `Data deleted successfully. ${result.rowCount} row(s) affected.`
    )
  })
}

export function executePostgresqlIntrospection(
  input: PostgresqlIntrospectInput,
  signal?: AbortSignal
) {
  return withPostgresClient(input, signal, async (client) => {
    const result = await introspectPostgresSchema(client, input.schema, signal)
    return {
      message: `Schema introspection completed. Found ${result.tables.length} table(s) in schema '${input.schema}'.`,
      tables: result.tables,
      schemas: result.schemas,
    }
  })
}
