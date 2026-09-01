/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { useTableViewPinStore } from '@/stores/table/view-pin/store'

describe('useTableViewPinStore', () => {
  beforeEach(() => {
    useTableViewPinStore.getState().reset()
  })

  it('keeps one pending pin per table, the latest winning', () => {
    const { pin } = useTableViewPinStore.getState()
    pin('tbl-1', 'view-a')
    pin('tbl-1', 'view-b')
    pin('tbl-2', 'view-c')

    const { pins } = useTableViewPinStore.getState()
    expect(pins['tbl-1'].viewId).toBe('view-b')
    expect(pins['tbl-2'].viewId).toBe('view-c')
  })

  it('re-pinning the same view is a new request, so a re-edit after the user moved on still switches', () => {
    const { pin } = useTableViewPinStore.getState()
    pin('tbl-1', 'view-a')
    const first = useTableViewPinStore.getState().pins['tbl-1']
    pin('tbl-1', 'view-a')
    const second = useTableViewPinStore.getState().pins['tbl-1']

    expect(second.viewId).toBe(first.viewId)
    expect(second.seq).toBeGreaterThan(first.seq)
  })

  it('consume clears only the pin it was handed, never a newer one', () => {
    const { pin, consume } = useTableViewPinStore.getState()
    pin('tbl-1', 'view-a')
    const stale = useTableViewPinStore.getState().pins['tbl-1']
    pin('tbl-1', 'view-b')

    consume('tbl-1', stale.seq)
    expect(useTableViewPinStore.getState().pins['tbl-1'].viewId).toBe('view-b')

    consume('tbl-1', useTableViewPinStore.getState().pins['tbl-1'].seq)
    expect(useTableViewPinStore.getState().pins['tbl-1']).toBeUndefined()
  })

  it('consuming a table with no pin is a no-op', () => {
    const before = useTableViewPinStore.getState().pins
    useTableViewPinStore.getState().consume('tbl-none', 1)
    expect(useTableViewPinStore.getState().pins).toBe(before)
  })

  it('clear removes a pending pin and leaves other tables alone', () => {
    const { pin, clear } = useTableViewPinStore.getState()
    pin('tbl-1', 'view-a')
    pin('tbl-2', 'view-b')

    clear('tbl-1')

    expect(useTableViewPinStore.getState().pins['tbl-1']).toBeUndefined()
    expect(useTableViewPinStore.getState().pins['tbl-2'].viewId).toBe('view-b')
  })
})
