import { db } from '@sim/db'
import { tableImports } from '@sim/db/schema'
import { and, eq, inArray } from 'drizzle-orm'

export type TableImportRecord = typeof tableImports.$inferSelect

export async function getTableImport(importId: string): Promise<TableImportRecord | null> {
  const [record] = await db
    .select()
    .from(tableImports)
    .where(eq(tableImports.id, importId))
    .limit(1)
  return record ?? null
}

export async function updateTrackedImportProgress(
  importId: string,
  rowsProcessed: number
): Promise<void> {
  await db
    .update(tableImports)
    .set({ status: 'processing', rowsProcessed, updatedAt: new Date() })
    .where(and(eq(tableImports.id, importId), eq(tableImports.status, 'processing')))
}

export async function markTrackedImportProcessing(importId: string): Promise<void> {
  const [claimed] = await db
    .update(tableImports)
    .set({ status: 'processing', updatedAt: new Date() })
    .where(and(eq(tableImports.id, importId), eq(tableImports.status, 'queued')))
    .returning({ id: tableImports.id })
  if (!claimed) throw new Error(`Table import ${importId} is no longer queued`)
}

export async function markTrackedImportTerminal(params: {
  importId: string
  status: 'completed' | 'failed' | 'canceled'
  rowsProcessed?: number
  error?: string | null
}): Promise<void> {
  const now = new Date()
  await db
    .update(tableImports)
    .set({
      status: params.status,
      ...(params.rowsProcessed === undefined ? {} : { rowsProcessed: params.rowsProcessed }),
      error: params.error ?? null,
      completedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(tableImports.id, params.importId),
        inArray(tableImports.status, ['uploading', 'preparing', 'queued', 'processing'])
      )
    )
}
