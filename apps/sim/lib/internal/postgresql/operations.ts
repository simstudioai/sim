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
    return {
      message: `Query executed successfully. ${result.rowCount} row(s) returned.`,
      rows: result.rows,
      rowCount: result.rowCount,
    }
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
    return {
      message: `SQL executed successfully. ${result.rowCount} row(s) affected.`,
      rows: result.rows,
      rowCount: result.rowCount,
    }
  })
}

export function executePostgresqlInsert(input: PostgresqlInsertInput, signal?: AbortSignal) {
  return withPostgresClient(input, signal, async (client) => {
    const result = await insertPostgresRows(client, input.table, input.data, signal)
    return {
      message: `Data inserted successfully. ${result.rowCount} row(s) affected.`,
      rows: result.rows,
      rowCount: result.rowCount,
    }
  })
}

export function executePostgresqlUpdate(input: PostgresqlUpdateInput, signal?: AbortSignal) {
  return withPostgresClient(input, signal, async (client) => {
    const result = await updatePostgresRows(client, input.table, input.data, input.where, signal)
    return {
      message: `Data updated successfully. ${result.rowCount} row(s) affected.`,
      rows: result.rows,
      rowCount: result.rowCount,
    }
  })
}

export function executePostgresqlDelete(input: PostgresqlDeleteInput, signal?: AbortSignal) {
  return withPostgresClient(input, signal, async (client) => {
    const result = await deletePostgresRows(client, input.table, input.where, signal)
    return {
      message: `Data deleted successfully. ${result.rowCount} row(s) affected.`,
      rows: result.rows,
      rowCount: result.rowCount,
    }
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
