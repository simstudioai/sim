import type { dataDrainRuns, dataDrains } from '@sim/db/schema'
import { type DataDrain, type DataDrainRun, dataDrainSchema } from '@/lib/api/contracts/data-drains'
import { getDestination } from '@/lib/data-drains/destinations/registry'

type DataDrainRow = typeof dataDrains.$inferSelect
type DataDrainRunRow = typeof dataDrainRuns.$inferSelect

/**
 * Projects a DB row into the public `DataDrain` wire shape. Strips the
 * encrypted credentials column and normalizes timestamps to ISO strings so
 * clients receive a stable, schema-validated payload.
 *
 * The stored `destinationConfig` is JSONB and is re-validated against the
 * destination's typed config schema before serialization so unexpected shapes
 * surface as errors instead of leaking through the response.
 */
export function serializeDrain(row: DataDrainRow): DataDrain {
  const destinationConfig = getDestination(row.destinationType).configSchema.parse(
    row.destinationConfig
  )
  return dataDrainSchema.parse({
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    source: row.source,
    scheduleCadence: row.scheduleCadence,
    enabled: row.enabled,
    cursor: row.cursor,
    lastRunAt: row.lastRunAt ? row.lastRunAt.toISOString() : null,
    lastSuccessAt: row.lastSuccessAt ? row.lastSuccessAt.toISOString() : null,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    destinationType: row.destinationType,
    destinationConfig,
  })
}

export function serializeDrainRun(row: DataDrainRunRow): DataDrainRun {
  return {
    id: row.id,
    drainId: row.drainId,
    status: row.status,
    trigger: row.trigger,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    rowsExported: row.rowsExported,
    bytesWritten: row.bytesWritten,
    cursorBefore: row.cursorBefore,
    cursorAfter: row.cursorAfter,
    error: row.error,
    locators: row.locators ?? [],
  }
}
