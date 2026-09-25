import { describe, expect, it } from 'vitest'
import type { TableViewWire } from '@/lib/api/contracts/tables'
import {
  getTableViewRevision,
  resolveTableViewPinTransition,
  resolveTableViewSelection,
  shouldApplyTableViewRevision,
} from '@/app/workspace/[workspaceId]/tables/[tableId]/view-state'

const DEFAULT_VIEW: TableViewWire = {
  id: 'view-default',
  tableId: 'table-1',
  name: 'Default',
  config: { filter: { all: [{ field: 'column-1', op: 'eq', value: 'Ada' }] } },
  isDefault: true,
  createdBy: 'user-1',
  createdAt: new Date('2026-08-15T01:00:00.000Z'),
  updatedAt: new Date('2026-08-15T01:10:00.000Z'),
}

describe('resolveTableViewSelection', () => {
  it('does not replace a pending selected id with the default view', () => {
    expect(resolveTableViewSelection([DEFAULT_VIEW], 'view-pending')).toEqual({
      selectedView: null,
      defaultView: DEFAULT_VIEW,
      activeView: null,
      pending: false,
    })
  })

  it('waits for the refreshed list before resolving an externally created view', () => {
    const created = { ...DEFAULT_VIEW, id: 'created-by-tool', isDefault: false }
    const stale = resolveTableViewSelection([DEFAULT_VIEW], created.id, undefined, true)
    expect(stale.pending).toBe(true)
    expect(stale.activeView).toBeNull()

    const refreshed = resolveTableViewSelection(
      [DEFAULT_VIEW, created],
      created.id,
      undefined,
      false
    )
    expect(refreshed.pending).toBe(false)
    expect(refreshed.activeView).toBe(created)

    const deleted = resolveTableViewSelection([DEFAULT_VIEW], created.id, undefined, false)
    expect(deleted.pending).toBe(false)
    expect(deleted.selectedView).toBeNull()
    expect(deleted.defaultView).toBe(DEFAULT_VIEW)
  })
})

describe('resolveTableViewPinTransition', () => {
  it('abandons a pending local creation when an external pin replaces its URL selection', () => {
    expect(
      resolveTableViewPinTransition('view-old', 'view-created', 'view-pinned', 'view-created')
    ).toEqual({ nextViewId: 'view-pinned', pendingCreatedViewId: null })
  })

  it('keeps a pending creation when it created the pinned view', () => {
    expect(
      resolveTableViewPinTransition('view-pinned', 'view-pinned', 'view-pinned', 'view-pinned')
    ).toEqual({ nextViewId: null, pendingCreatedViewId: 'view-pinned' })
  })
})

describe('shouldApplyTableViewRevision', () => {
  const cached = {
    id: 'view-1',
    updatedAt: new Date('2026-08-15T01:09:29.136Z'),
  }

  it('does not rewind local state while autosave is still pending', () => {
    const applied = getTableViewRevision(cached)
    const saved = getTableViewRevision({
      ...cached,
      updatedAt: new Date('2026-08-15T01:10:47.737Z'),
    })

    expect(shouldApplyTableViewRevision(applied, saved, true)).toBe(false)
  })

  it('ignores an older response for the same view', () => {
    const applied = getTableViewRevision(cached)
    const stale = getTableViewRevision({
      ...cached,
      updatedAt: new Date('2026-08-15T01:08:00.000Z'),
    })

    expect(shouldApplyTableViewRevision(applied, stale, false)).toBe(false)
  })
})
