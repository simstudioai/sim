import {
  createExecutorPrincipalFromExecutionContext,
  requireExecutorWorkspaceId,
} from '@/lib/internal/principals/executor'
import type { InternalToolOperationContext } from '@/lib/internal/tool-operations/types'
import { readTableDefinitionUseCase } from '@/lib/table/application/tables'
import { isColumnType } from '@/lib/table/column-types'
import type { TableSummary } from '@/lib/table/types'

export interface ReadTableSchemaAsExecutorInput {
  tableId: string
  context: InternalToolOperationContext
}

export async function readTableSchemaAsExecutor({
  tableId,
  context,
}: ReadTableSchemaAsExecutorInput): Promise<TableSummary> {
  const principal = await createExecutorPrincipalFromExecutionContext({
    context,
  })
  const { table } = await readTableDefinitionUseCase.execute({
    principal,
    input: { tableId, workspaceId: requireExecutorWorkspaceId(context) },
  })

  if (!table || typeof table.name !== 'string' || !Array.isArray(table.schema?.columns)) {
    throw new Error(`Invalid table metadata while enriching schema for ${tableId}`)
  }

  const columns = table.schema.columns.map((column, index) => {
    if (typeof column.name !== 'string' || !isColumnType(column.type)) {
      throw new Error(`Invalid table column ${index} while enriching schema for ${tableId}`)
    }
    // `multiple` is a select-only concern (it decides which filter operators the
    // column accepts), so it is carried only where it means something rather
    // than stamped onto every column.
    return column.type === 'select'
      ? { name: column.name, type: column.type, multiple: column.multiple === true }
      : { name: column.name, type: column.type }
  })

  return { name: table.name, columns }
}
