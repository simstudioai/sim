import { describe, expect, it } from 'vitest'
import { schemaFingerprint } from '@/lib/table/schema-fingerprint'
import type { TableSchema } from '@/lib/table/types'

function schema(columns: Array<{ id?: string; name: string }>): TableSchema {
  return { columns: columns.map((c) => ({ ...c, type: 'string' })) } as TableSchema
}

describe('schemaFingerprint', () => {
  it('is stable for the same column shape', () => {
    const a = schemaFingerprint(schema([{ id: 'col_1', name: 'email' }]))
    const b = schemaFingerprint(schema([{ id: 'col_1', name: 'email' }]))
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{12}$/)
  })

  it('changes on rename, add, and reorder', () => {
    const base = schemaFingerprint(
      schema([
        { id: 'col_1', name: 'email' },
        { id: 'col_2', name: 'age' },
      ])
    )
    const renamed = schemaFingerprint(
      schema([
        { id: 'col_1', name: 'contact' },
        { id: 'col_2', name: 'age' },
      ])
    )
    const added = schemaFingerprint(
      schema([
        { id: 'col_1', name: 'email' },
        { id: 'col_2', name: 'age' },
        { id: 'col_3', name: 'city' },
      ])
    )
    const reordered = schemaFingerprint(
      schema([
        { id: 'col_2', name: 'age' },
        { id: 'col_1', name: 'email' },
      ])
    )
    expect(new Set([base, renamed, added, reordered]).size).toBe(4)
  })

  it('keys legacy columns without ids by name (getColumnId fallback)', () => {
    const legacy = schemaFingerprint(schema([{ name: 'email' }]))
    const withId = schemaFingerprint(schema([{ id: 'col_1', name: 'email' }]))
    expect(legacy).not.toBe(withId)
  })

  it('changes on a pure metadata.columnOrder reorder of the RAW schema', () => {
    // The user-visible order lives in metadata.columnOrder and is written by a
    // metadata-only update (no schema write, no rows_version bump) — the hash
    // is the ONLY signal such a reorder can move, so it must move.
    const raw = schema([
      { id: 'col_1', name: 'email' },
      { id: 'col_2', name: 'age' },
    ])
    const unordered = schemaFingerprint(raw, null)
    const reordered = schemaFingerprint(raw, { columnOrder: ['col_2', 'col_1'] })
    expect(reordered).not.toBe(unordered)

    // Raw schema + metadata order must hash identically to an already
    // order-applied schema (getTableById/listTables output) without metadata —
    // otherwise the same table carries two hashes across call sites.
    const applied = schemaFingerprint(
      schema([
        { id: 'col_2', name: 'age' },
        { id: 'col_1', name: 'email' },
      ])
    )
    expect(reordered).toBe(applied)
  })

  it('matches the golden hash (pins the storage-key format across refactors)', () => {
    // Snapshot-cache storage keys embed this hash
    // (table-snapshots/{ws}/{tableId}/v{version}-{hash}.csv). Changing the
    // hashed shape orphans every cached CSV and emits a one-time '~table'
    // delta for every table in every live chat — if this assertion fails,
    // that blast radius is intentional and reviewed, or the change is wrong.
    const golden = schemaFingerprint(
      schema([
        { id: 'col_1', name: 'email' },
        { id: 'col_2', name: 'age' },
      ])
    )
    expect(golden).toBe('f49aa06b1b7c')
  })
})
