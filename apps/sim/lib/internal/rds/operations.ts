import type { RDSDataClient } from '@aws-sdk/client-rds-data'
import {
  createRdsClient,
  executeDelete,
  executeInsert,
  executeIntrospect,
  executeStatement,
  executeUpdate,
  validateQuery,
} from '@/lib/internal/rds/client'
import type {
  RdsDeleteInput,
  RdsExecuteInput,
  RdsInsertInput,
  RdsIntrospectInput,
  RdsQueryInput,
  RdsUpdateInput,
} from '@/lib/internal/rds/schema'
import type { RdsConnectionConfig } from '@/tools/rds/types'

export class RdsOperationInputError extends Error {}

async function withRdsClient<T>(
  input: RdsConnectionConfig,
  execute: (client: RDSDataClient) => Promise<T>
): Promise<T> {
  const client = createRdsClient(input)
  try {
    return await execute(client)
  } finally {
    client.destroy()
  }
}

export function executeRdsQuery(input: RdsQueryInput, signal?: AbortSignal) {
  const validation = validateQuery(input.query)
  if (!validation.isValid) {
    throw new RdsOperationInputError(validation.error ?? 'Invalid query')
  }

  return withRdsClient(input, async (client) => {
    const result = await executeStatement(
      client,
      input.resourceArn,
      input.secretArn,
      input.database,
      input.query,
      undefined,
      signal
    )
    return {
      message: `Query executed successfully. ${result.rowCount} row(s) returned.`,
      rows: result.rows,
      rowCount: result.rowCount,
    }
  })
}

export function executeRdsStatement(input: RdsExecuteInput, signal?: AbortSignal) {
  return withRdsClient(input, async (client) => {
    const result = await executeStatement(
      client,
      input.resourceArn,
      input.secretArn,
      input.database,
      input.query,
      undefined,
      signal
    )
    return {
      message: `Query executed successfully. ${result.rowCount} row(s) affected.`,
      rows: result.rows,
      rowCount: result.rowCount,
    }
  })
}

export function executeRdsInsert(input: RdsInsertInput, signal?: AbortSignal) {
  return withRdsClient(input, async (client) => {
    const result = await executeInsert(
      client,
      input.resourceArn,
      input.secretArn,
      input.database,
      input.table,
      input.data,
      signal
    )
    return {
      message: `Insert executed successfully. ${result.rowCount} row(s) inserted.`,
      rows: result.rows,
      rowCount: result.rowCount,
    }
  })
}

export function executeRdsUpdate(input: RdsUpdateInput, signal?: AbortSignal) {
  return withRdsClient(input, async (client) => {
    const result = await executeUpdate(
      client,
      input.resourceArn,
      input.secretArn,
      input.database,
      input.table,
      input.data,
      input.conditions,
      signal
    )
    return {
      message: `Update executed successfully. ${result.rowCount} row(s) updated.`,
      rows: result.rows,
      rowCount: result.rowCount,
    }
  })
}

export function executeRdsDelete(input: RdsDeleteInput, signal?: AbortSignal) {
  return withRdsClient(input, async (client) => {
    const result = await executeDelete(
      client,
      input.resourceArn,
      input.secretArn,
      input.database,
      input.table,
      input.conditions,
      signal
    )
    return {
      message: `Delete executed successfully. ${result.rowCount} row(s) deleted.`,
      rows: result.rows,
      rowCount: result.rowCount,
    }
  })
}

export function executeRdsIntrospection(input: RdsIntrospectInput, signal?: AbortSignal) {
  return withRdsClient(input, async (client) => {
    const result = await executeIntrospect(
      client,
      input.resourceArn,
      input.secretArn,
      input.database,
      input.schema,
      input.engine,
      signal
    )
    return {
      message: `Schema introspection completed. Engine: ${result.engine}. Found ${result.tables.length} table(s).`,
      engine: result.engine,
      tables: result.tables,
      schemas: result.schemas,
    }
  })
}
