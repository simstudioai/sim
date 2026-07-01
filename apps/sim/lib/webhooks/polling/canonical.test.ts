/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { readCanonicalTriggerValue } from '@/lib/webhooks/polling/canonical'

describe('readCanonicalTriggerValue', () => {
  it('returns the canonical value when present', () => {
    expect(readCanonicalTriggerValue('canon', 'basic', 'advanced')).toBe('canon')
  })

  it('falls back basic-first when the canonical key is absent (transitional)', () => {
    expect(readCanonicalTriggerValue(undefined, 'basic', 'advanced')).toBe('basic')
  })

  it('falls back to the advanced value when canonical and basic are absent', () => {
    expect(readCanonicalTriggerValue(undefined, undefined, 'advanced')).toBe('advanced')
  })

  it('treats empty strings as unset', () => {
    expect(readCanonicalTriggerValue('', '', 'advanced')).toBe('advanced')
    expect(readCanonicalTriggerValue('', '')).toBeUndefined()
  })

  it('ignores non-string members', () => {
    expect(readCanonicalTriggerValue(null, 42 as unknown, 'advanced')).toBe('advanced')
    expect(readCanonicalTriggerValue(undefined, undefined)).toBeUndefined()
  })

  /**
   * No-repoint invariant: for every config shape the previous app version could
   * have stored, the new canonical-first read must resolve to the SAME resource
   * the old basic-first read returned — whether the row has been backfilled
   * (canonical key present) or not (transitional fallback). The legacy
   * basic-first read is reproduced inline as the source of truth.
   */
  describe('no-repoint across legacy and backfilled shapes', () => {
    interface GoogleDriveConfig {
      folderId?: string
      manualFolderId?: string
    }
    // The exact pre-change Google Drive poller read (basic key === canonical key).
    const legacyDriveRead = (c: GoogleDriveConfig) => c.folderId || c.manualFolderId
    // Mirror of the migration 0253 backfill: fill the canonical key basic-first
    // ONLY when absent. For Drive the canonical key IS the basic key (folderId).
    const backfillDrive = (c: GoogleDriveConfig): GoogleDriveConfig =>
      c.folderId ? c : { ...c, folderId: c.folderId || c.manualFolderId }

    const driveShapes: GoogleDriveConfig[] = [
      { folderId: 'basic-only' },
      { manualFolderId: 'advanced-only' },
      // Drift: stale basic + active advanced both stored. Current poller reads basic.
      { folderId: 'STALE', manualFolderId: 'ACTIVE' },
      {},
    ]

    it.each(driveShapes)('Drive legacy config %o reads same resource as before', (config) => {
      const before = legacyDriveRead(config)
      const after = readCanonicalTriggerValue(config.folderId, config.manualFolderId)
      expect(after).toBe(before || undefined)
    })

    it.each(driveShapes)('Drive backfilled config %o reads same resource as before', (config) => {
      const before = legacyDriveRead(config)
      const backfilled = backfillDrive(config)
      const after = readCanonicalTriggerValue(backfilled.folderId, backfilled.manualFolderId)
      expect(after).toBe(before || undefined)
    })

    interface TableConfig {
      tableId?: string
      tableSelector?: string
      manualTableId?: string
    }
    // The exact pre-change table reader (already canonical-first, but tableId was
    // never written, so it fell through to the raw keys).
    const legacyTableRead = (c: TableConfig) => c.tableId ?? c.tableSelector ?? c.manualTableId
    // Mirror of the migration 0253 backfill for table (canonical key is distinct).
    const backfillTable = (c: TableConfig): TableConfig =>
      c.tableId ? c : { ...c, tableId: c.tableSelector ?? c.manualTableId }

    const tableShapes: TableConfig[] = [
      { tableSelector: 'basic-only' },
      { manualTableId: 'advanced-only' },
      { tableSelector: 'STALE', manualTableId: 'ACTIVE' },
      { tableId: 'collapsed', tableSelector: 'STALE', manualTableId: 'ACTIVE' },
      {},
    ]

    it.each(tableShapes)('table legacy config %o reads same resource as before', (config) => {
      const before = legacyTableRead(config)
      const after = readCanonicalTriggerValue(
        config.tableId,
        config.tableSelector,
        config.manualTableId
      )
      expect(after).toBe(before ?? undefined)
    })

    it.each(tableShapes)('table backfilled config %o reads same resource as before', (config) => {
      const before = legacyTableRead(config)
      const backfilled = backfillTable(config)
      const after = readCanonicalTriggerValue(
        backfilled.tableId,
        backfilled.tableSelector,
        backfilled.manualTableId
      )
      expect(after).toBe(before ?? undefined)
    })
  })
})
