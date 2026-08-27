/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettingsDirtyStore } from '@/stores/settings/dirty/store'

describe('settings dirty store', () => {
  beforeEach(() => {
    useSettingsDirtyStore.getState().reset()
  })

  it('blocks navigation without creating a discard action while a save is in flight', () => {
    const leave = vi.fn()
    useSettingsDirtyStore.getState().setDirty(true)
    useSettingsDirtyStore.getState().setNavigationBlocked(true)

    expect(useSettingsDirtyStore.getState().requestLeave(leave)).toBe(false)
    expect(useSettingsDirtyStore.getState().pendingLeave).toBeNull()
    useSettingsDirtyStore.getState().confirmLeave()
    expect(leave).not.toHaveBeenCalled()
  })

  it('allows the normal discard flow after navigation is unblocked', () => {
    const leave = vi.fn()
    useSettingsDirtyStore.getState().setDirty(true)
    useSettingsDirtyStore.getState().setNavigationBlocked(true)
    useSettingsDirtyStore.getState().setNavigationBlocked(false)

    expect(useSettingsDirtyStore.getState().requestLeave(leave)).toBe(false)
    expect(useSettingsDirtyStore.getState().pendingLeave).toBe(leave)
    useSettingsDirtyStore.getState().confirmLeave()
    expect(leave).toHaveBeenCalledOnce()
  })
})
