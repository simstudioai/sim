import type { dataDrainRuns } from '@sim/db/schema'
import { truncate } from '@sim/utils/string'
import type { DataDrainRecord } from '@/lib/data-drains/application/use-cases'
import { updateDataDrainBodySchema } from '@/lib/data-drains/validation'

/** Credentials and destination changes stay in the secure organization Settings form. */
export const dataDrainToolPatchSchema = updateDataDrainBodySchema
  .pick({ name: true, scheduleCadence: true, enabled: true })
  .strict()

/** Destination URLs and identifiers can themselves contain secrets; never return config to tools. */
export function projectDataDrainForTool(row: DataDrainRecord) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: truncate(row.name, 120, ''),
    source: row.source,
    destinationType: row.destinationType,
    scheduleCadence: row.scheduleCadence,
    enabled: row.enabled,
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
    lastSuccessAt: row.lastSuccessAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** Provider errors, cursors and locators may include credentials or exported customer data. */
export function projectDataDrainRunForTool(row: typeof dataDrainRuns.$inferSelect) {
  return {
    id: row.id,
    drainId: row.drainId,
    status: row.status,
    trigger: row.trigger,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    rowsExported: row.rowsExported,
    bytesWritten: row.bytesWritten,
  }
}
