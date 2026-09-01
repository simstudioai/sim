import { getErrorMessage } from '@sim/utils/errors'
import { createMSSQLConnection, type MSSQLConnectionConfig } from '@/lib/internal/mssql/client'
import { executeIntrospect } from '@/lib/internal/mssql/introspection'
import {
  buildDeleteQuery,
  buildInsertQuery,
  buildUpdateQuery,
  executeQuery,
  toRowsResponseBody,
  validateQuery,
  validateReadOnlyQuery,
} from '@/lib/internal/mssql/query'
import type {
  MssqlDeleteInput,
  MssqlExecuteInput,
  MssqlInsertInput,
  MssqlIntrospectInput,
  MssqlQueryInput,
  MssqlUpdateInput,
} from '@/lib/internal/mssql/schema'

export class MssqlOperationInputError extends Error {}

async function withMssqlConnection<TResult>(
  input: MSSQLConnectionConfig,
  signal: AbortSignal | undefined,
  execute: (pool: Awaited<ReturnType<typeof createMSSQLConnection>>) => Promise<TResult>
): Promise<TResult> {
  const pool = await createMSSQLConnection(input, signal)
  try {
    return await execute(pool)
  } finally {
    await pool.close()
  }
}

function requireValidQuery(query: string, readOnly: boolean): void {
  const validation = readOnly ? validateReadOnlyQuery(query) : validateQuery(query)
  if (!validation.isValid) {
    throw new MssqlOperationInputError(
      `Query validation failed: ${validation.error ?? 'Invalid query'}`
    )
  }
}

function buildStatement(
  operation: 'insert' | 'update' | 'delete',
  build: () => { query: string; values: unknown[] }
): { query: string; values: unknown[] } {
  try {
    return build()
  } catch (error) {
    throw new MssqlOperationInputError(
      `Microsoft SQL Server ${operation} failed: ${getErrorMessage(error, 'Invalid statement')}`
    )
  }
}

export function executeMssqlQuery(input: MssqlQueryInput, signal?: AbortSignal) {
  requireValidQuery(input.query, true)

  return withMssqlConnection(input, signal, async (pool) => {
    const result = await executeQuery(pool, input.query, [], signal)
    return toRowsResponseBody(
      result,
      `Query executed successfully. ${result.rowCount} row(s) returned.`
    )
  })
}

export function executeMssqlStatement(input: MssqlExecuteInput, signal?: AbortSignal) {
  requireValidQuery(input.query, false)

  return withMssqlConnection(input, signal, async (pool) => {
    const result = await executeQuery(pool, input.query, [], signal)
    return toRowsResponseBody(
      result,
      `SQL executed successfully. ${result.rowCount} row(s) affected.`
    )
  })
}

export function executeMssqlInsert(input: MssqlInsertInput, signal?: AbortSignal) {
  const statement = buildStatement('insert', () => buildInsertQuery(input.table, input.data))

  return withMssqlConnection(input, signal, async (pool) => {
    const result = await executeQuery(pool, statement.query, statement.values, signal)
    return toRowsResponseBody(
      result,
      `Data inserted successfully. ${result.rowCount} row(s) affected.`
    )
  })
}

export function executeMssqlUpdate(input: MssqlUpdateInput, signal?: AbortSignal) {
  const statement = buildStatement('update', () =>
    buildUpdateQuery(input.table, input.data, input.where)
  )

  return withMssqlConnection(input, signal, async (pool) => {
    const result = await executeQuery(pool, statement.query, statement.values, signal)
    return toRowsResponseBody(
      result,
      `Data updated successfully. ${result.rowCount} row(s) affected.`
    )
  })
}

export function executeMssqlDelete(input: MssqlDeleteInput, signal?: AbortSignal) {
  const statement = buildStatement('delete', () => buildDeleteQuery(input.table, input.where))

  return withMssqlConnection(input, signal, async (pool) => {
    const result = await executeQuery(pool, statement.query, statement.values, signal)
    return toRowsResponseBody(
      result,
      `Data deleted successfully. ${result.rowCount} row(s) affected.`
    )
  })
}

export function executeMssqlIntrospection(input: MssqlIntrospectInput, signal?: AbortSignal) {
  return withMssqlConnection(input, signal, async (pool) => {
    const result = await executeIntrospect(pool, input.schema, signal)
    return {
      message: `Schema introspection completed. Found ${result.tables.length} table(s) in schema '${input.schema}'.`,
      tables: result.tables,
      schemas: result.schemas,
    }
  })
}
