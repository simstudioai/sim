import { getTableById } from '@/lib/table/service'
import type { TableDefinition } from '@/lib/table/types'
import { getVirtualTableById } from '@/lib/virtual-tables/service.server'

export async function resolveTableById(tableId: string): Promise<TableDefinition | null> {
  const virtualTable = await getVirtualTableById(tableId)
  if (virtualTable) return virtualTable
  return getTableById(tableId)
}
