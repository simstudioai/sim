/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { TableViewWire } from '@/lib/api/contracts/tables'
import { ALL_VIEW_PARAM } from '@/app/workspace/[workspaceId]/tables/[tableId]/search-params'
import {
  getTableViewRevision,
  resolveTableViewConfig,
  resolveTableViewPinTransition,
  resolveTableViewSelection,
  shouldApplyTableViewRevision,
} from '@/app/workspace/[workspaceId]/tables/[tableId]/view-state'

describe('resolveTableViewConfig', () => {
  it('inherits layout metadata when an ungated default view is still empty', () => {
    const metadata = {
      columnWidths: { 'column-1': 240 },
      columnOrder: ['column-1'],
      pinnedColumns: ['column-1'],
      hiddenColumns: ['column-2'],
    }

    expect(resolveTableViewConfig(metadata, {})).toEqual(metadata)
  })

  it('lets explicitly stored view fields override the metadata baseline', () => {
    expect(
      resolveTableViewConfig(
        { columnWidths: { 'column-1': 240 }, pinnedColumns: ['column-1'] },
        { columnWidths: { 'column-1': 180 }, pinnedColumns: [] }
      )
    ).toEqual({ columnWidths: { 'column-1': 180 }, pinnedColumns: [] })
  })
})

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
  it('makes the persisted default active before its URL id is adopted', () => {
    expect(resolveTableViewSelection([DEFAULT_VIEW], null)).toEqual({
      selectedView: null,
      defaultView: DEFAULT_VIEW,
      activeView: DEFAULT_VIEW,
    })
  })

  it('advances the applied revision when a default arrives after an empty cached list', () => {
    const emptySelection = resolveTableViewSelection([], null)
    const loadedSelection = resolveTableViewSelection([DEFAULT_VIEW], null)

    expect(
      shouldApplyTableViewRevision(
        getTableViewRevision(emptySelection.activeView),
        getTableViewRevision(loadedSelection.activeView),
        false
      )
    ).toBe(true)
  })

  it('does not replace a pending selected id with the default view', () => {
    expect(resolveTableViewSelection([DEFAULT_VIEW], 'view-pending')).toEqual({
      selectedView: null,
      defaultView: DEFAULT_VIEW,
      activeView: null,
    })
  })

  it('upgrades the legacy All sentinel when a persisted default exists', () => {
    expect(resolveTableViewSelection([DEFAULT_VIEW], ALL_VIEW_PARAM).activeView).toBe(DEFAULT_VIEW)
  })
})

describe('resolveTableViewPinTransition', () => {
  it('abandons a pending local creation when an external pin replaces its URL selection', () => {
    expect(
      resolveTableViewPinTransition('view-old', 'view-created', 'view-pinned', 'view-created')
    ).toEqual({ nextViewId: 'view-pinned', pendingCreatedViewId: null })
  })

  it('keeps the pending creation when the pin is already represented locally', () => {
    expect(
      resolveTableViewPinTransition('view-pinned', 'view-created', 'view-pinned', 'view-created')
    ).toEqual({ nextViewId: null, pendingCreatedViewId: 'view-created' })
  })
})

describe('shouldApplyTableViewRevision', () => {
  const cached = {
    id: 'view-1',
    updatedAt: new Date('2026-08-15T01:09:29.136Z'),
  }

  it('reapplies a refreshed config for the same view after autosave settles', () => {
    const applied = getTableViewRevision(cached)
    const saved = getTableViewRevision({
      ...cached,
      updatedAt: new Date('2026-08-15T01:10:47.737Z'),
    })

    expect(shouldApplyTableViewRevision(applied, saved, false)).toBe(true)
  })

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

  it('applies a different view even while the previous view is saving', () => {
    const applied = getTableViewRevision(cached)
    const selected = getTableViewRevision({
      id: 'view-2',
      updatedAt: new Date('2026-08-15T01:09:00.000Z'),
    })

    expect(shouldApplyTableViewRevision(applied, selected, true)).toBe(true)
  })
})
