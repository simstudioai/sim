import { beforeEach, describe, expect, it } from 'vitest'
import { useTableViewPinStore } from '@/stores/table/view-pin/store'
import { resetRegisteredUserData } from '@/stores/user-data-reset-registry'

describe('useTableViewPinStore', () => {
  beforeEach(() => {
    useTableViewPinStore.getState().reset()
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

  it('clears pending pins when the authenticated identity changes', () => {
    useTableViewPinStore.getState().pin('tbl-1', 'view-a')

    resetRegisteredUserData()

    expect(useTableViewPinStore.getState().pins).toEqual({})
    expect(useTableViewPinStore.getState().nextSeq).toBe(1)
  })
})
