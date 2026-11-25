import { dryRunId } from '@/tools/dry-run'

/**
 * A dry run's placeholder for the records a write returns: each with the fields the call writes
 * (before Airtable's typecast, and without the fields it already held) and the id the call names,
 * or a placeholder id for a record Airtable picks.
 */
export function placeholderRecords(
  records: ReadonlyArray<{ id?: string; fields: Record<string, unknown> }>
) {
  return records.map((record, index) => ({
    id: record.id ?? dryRunId('record', index + 1),
    fields: record.fields,
  }))
}
