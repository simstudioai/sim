import { type Column, type SQL, sql } from 'drizzle-orm'

/**
 * Marks a schedule carrier job as reconciled against its persisted execution
 * log. Schedule recovery owns these rows, so retention only deletes a carrier
 * once this key is present.
 */
export const SCHEDULE_CARRIER_RECONCILED_METADATA_KEY = 'scheduleReconciled'

/**
 * Marks a reconciled carrier whose payload could not be interpreted, so its
 * schedule accounting can never be replayed. Retention holds these tombstones
 * past normal job retention, bounded by
 * {@link SCHEDULE_CARRIER_IRRECOVERABLE_RETENTION_HOURS}.
 */
export const SCHEDULE_CARRIER_IRRECOVERABLE_METADATA_KEY = 'scheduleRecoveryIrrecoverable'

/**
 * How long an irrecoverable carrier tombstone is kept past normal job
 * retention. These rows exist only for operator forensics — a carrier whose
 * payload could not be read, so its schedule accounting can never be replayed
 * — and they are the one class of carrier that can never clear on its own, so
 * the window has to be bounded rather than infinite.
 */
export const SCHEDULE_CARRIER_IRRECOVERABLE_RETENTION_HOURS = 30 * 24

/**
 * `COALESCE(metadata ->> '<key>', 'false')`, with the key spelled as a SQL
 * *literal* rather than a bind parameter.
 *
 * This is load-bearing for the partial index
 * `async_jobs_schedule_unreconciled_terminal_idx`, whose predicate is written
 * with the same literal: Postgres cannot prove that a parameterised predicate
 * implies a literal one, so a bound key silently drops the recovery scan to a
 * sequential scan of `async_jobs`. The key is a fixed identifier defined above,
 * so there is no injection surface.
 *
 * The metadata column is a parameter rather than an import so this module never
 * pins a second copy of the schema.
 */
function carrierMetadataFlag(metadata: Column, key: string): SQL {
  return sql`COALESCE(${metadata} ->> ${sql.raw(`'${key}'`)}, 'false')`
}

/** Carriers whose schedule accounting has not been replayed yet. */
export function carrierNotReconciledSql(metadata: Column): SQL {
  return sql`${carrierMetadataFlag(metadata, SCHEDULE_CARRIER_RECONCILED_METADATA_KEY)} <> 'true'`
}

/** Carriers whose schedule accounting was replayed, successfully or not. */
export function carrierReconciledSql(metadata: Column): SQL {
  return sql`${carrierMetadataFlag(metadata, SCHEDULE_CARRIER_RECONCILED_METADATA_KEY)} = 'true'`
}

/** Reconciled carriers whose payload could never be interpreted. */
export function carrierNotIrrecoverableSql(metadata: Column): SQL {
  return sql`${carrierMetadataFlag(metadata, SCHEDULE_CARRIER_IRRECOVERABLE_METADATA_KEY)} <> 'true'`
}

/**
 * Builds the jsonb merge that stamps reconciliation bookkeeping onto a carrier
 * while preserving every other metadata key it already carries.
 */
export function buildCarrierReconciledMetadata(
  metadata: Column,
  options: { irrecoverable?: boolean } = {}
): SQL {
  const patch: Record<string, boolean> = {
    [SCHEDULE_CARRIER_RECONCILED_METADATA_KEY]: true,
  }
  if (options.irrecoverable) {
    patch[SCHEDULE_CARRIER_IRRECOVERABLE_METADATA_KEY] = true
  }

  return sql`COALESCE(${metadata}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`
}
