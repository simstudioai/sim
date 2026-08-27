import { createExecutorPrincipal } from '@/lib/internal/principals/executor'
import { TABLE_DELEGATION_AUDIENCE } from '@/lib/table/application/authorization'
import { readTableDefinitionUseCase } from '@/lib/table/application/tables'
import { isColumnType } from '@/lib/table/column-types'
import type { TableSummary } from '@/lib/table/types'

export interface ReadTableSchemaAsExecutorInput {
  tableId: string
  userId: string
  workflowId: string
  executionId?: string
}

export async function readTableSchemaAsExecutor({
  tableId,
  userId,
  workflowId,
  executionId,
}: ReadTableSchemaAsExecutorInput): Promise<TableSummary> {
  const principal = await createExecutorPrincipal({
    userId,
    workflowId,
    ...(executionId ? { executionId } : {}),
    audience: TABLE_DELEGATION_AUDIENCE,
    resourceScope: { tableId },
  })
  const { table } = await readTableDefinitionUseCase.execute({
    principal,
    input: { tableId, workspaceId: principal.workspaceId },
  })

  if (!table || typeof table.name !== 'string' || !Array.isArray(table.schema?.columns)) {
    throw new Error(`Invalid table metadata while enriching schema for ${tableId}`)
  }

  const columns = table.schema.columns.map((column, index) => {
    if (typeof column.name !== 'string' || !isColumnType(column.type)) {
      throw new Error(`Invalid table column ${index} while enriching schema for ${tableId}`)
    }
    return { name: column.name, type: column.type }
  })

  return { name: table.name, columns }
}
