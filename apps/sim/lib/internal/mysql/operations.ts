import { createMysqlConnection, type MysqlConnectionConfig } from '@/lib/internal/mysql/client'
import {
  buildMysqlDeleteQuery,
  buildMysqlInsertQuery,
  buildMysqlUpdateQuery,
  introspectMysqlDatabase,
  queryMysql,
  validateMysqlQuery,
} from '@/lib/internal/mysql/queries'
import type {
  MysqlDeleteInput,
  MysqlExecuteInput,
  MysqlInsertInput,
  MysqlIntrospectInput,
  MysqlQueryInput,
  MysqlUpdateInput,
} from '@/lib/internal/mysql/schema'
import { toRowsResponseBody } from '@/lib/internal/tool-operations/response-limits'

export class MysqlOperationInputError extends Error {}

async function withMysqlConnection<TResult>(
  input: MysqlConnectionConfig,
  signal: AbortSignal | undefined,
  execute: (connection: Awaited<ReturnType<typeof createMysqlConnection>>) => Promise<TResult>
): Promise<TResult> {
  const connection = await createMysqlConnection(input, signal)
  try {
    return await execute(connection)
  } finally {
    await connection.end()
  }
}

function validateOperationQuery(query: string): void {
  const validation = validateMysqlQuery(query)
  if (!validation.isValid) {
    throw new MysqlOperationInputError(
      `Query validation failed: ${validation.error ?? 'Invalid query'}`
    )
  }
}

export function executeMysqlQuery(input: MysqlQueryInput, signal?: AbortSignal) {
  validateOperationQuery(input.query)

  return withMysqlConnection(input, signal, async (connection) => {
    const result = await queryMysql(connection, input.query, undefined, signal)
    return toRowsResponseBody(
      result,
      `Query executed successfully. ${result.rowCount} row(s) returned.`
    )
  })
}

export function executeMysqlStatement(input: MysqlExecuteInput, signal?: AbortSignal) {
  validateOperationQuery(input.query)

  return withMysqlConnection(input, signal, async (connection) => {
    const result = await queryMysql(connection, input.query, undefined, signal)
    return toRowsResponseBody(
      result,
      `SQL executed successfully. ${result.rowCount} row(s) affected.`
    )
  })
}

export function executeMysqlInsert(input: MysqlInsertInput, signal?: AbortSignal) {
  return withMysqlConnection(input, signal, async (connection) => {
    const { query, values } = buildMysqlInsertQuery(input.table, input.data)
    const result = await queryMysql(connection, query, values, signal)
    return toRowsResponseBody(
      result,
      `Data inserted successfully. ${result.rowCount} row(s) affected.`
    )
  })
}

export function executeMysqlUpdate(input: MysqlUpdateInput, signal?: AbortSignal) {
  return withMysqlConnection(input, signal, async (connection) => {
    const { query, values } = buildMysqlUpdateQuery(input.table, input.data, input.where)
    const result = await queryMysql(connection, query, values, signal)
    return toRowsResponseBody(
      result,
      `Data updated successfully. ${result.rowCount} row(s) affected.`
    )
  })
}

export function executeMysqlDelete(input: MysqlDeleteInput, signal?: AbortSignal) {
  return withMysqlConnection(input, signal, async (connection) => {
    const { query, values } = buildMysqlDeleteQuery(input.table, input.where)
    const result = await queryMysql(connection, query, values, signal)
    return toRowsResponseBody(
      result,
      `Data deleted successfully. ${result.rowCount} row(s) affected.`
    )
  })
}

export function executeMysqlIntrospection(input: MysqlIntrospectInput, signal?: AbortSignal) {
  return withMysqlConnection(input, signal, async (connection) => {
    const result = await introspectMysqlDatabase(connection, input.database, signal)
    return {
      message: `Schema introspection completed. Found ${result.tables.length} table(s) in database '${input.database}'.`,
      tables: result.tables,
      databases: result.databases,
    }
  })
}
