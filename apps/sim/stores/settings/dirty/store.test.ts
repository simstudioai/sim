import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettingsDirtyStore } from '@/stores/settings/dirty/store'

describe('settings dirty store', () => {
  beforeEach(() => {
    useSettingsDirtyStore.getState().reset()
  })

  it('blocks navigation without creating a discard action while a save is in flight', () => {
    const leave = vi.fn()
    useSettingsDirtyStore.getState().setGuard('editor', { isDirty: true, navigationBlocked: true })

    expect(useSettingsDirtyStore.getState().requestLeave(leave)).toBe(false)
    expect(useSettingsDirtyStore.getState().pendingLeave).toBeNull()
    useSettingsDirtyStore.getState().confirmLeave()
    expect(leave).not.toHaveBeenCalled()
  })
})
