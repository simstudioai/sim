import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import type { SettingsSection } from '@/app/workspace/[workspaceId]/settings/navigation'

interface SettingsDirtyStore {
  isDirty: boolean
  pendingSection: SettingsSection | null
  setDirty: (dirty: boolean) => void
  /**
   * Call before navigating to a new section. Returns `true` if navigation may
   * proceed immediately; returns `false` if there are unsaved changes — in that
   * case `pendingSection` is set so a confirmation dialog can be shown.
   */
  requestNavigation: (section: SettingsSection) => boolean
  /** Clears dirty + pending state and returns the section to navigate to. */
  confirmNavigation: () => SettingsSection | null
  /** Cancels a pending navigation without clearing dirty state. */
  cancelNavigation: () => void
  /** Resets all state — call on component unmount. */
  reset: () => void
}

const initialState = {
  isDirty: false,
  pendingSection: null as SettingsSection | null,
}

export const useSettingsDirtyStore = create<SettingsDirtyStore>()(
  devtools(
    (set, get) => ({
      ...initialState,

      setDirty: (dirty) => set({ isDirty: dirty }),

      requestNavigation: (section) => {
        if (!get().isDirty) return true
        set({ pendingSection: section })
        return false
      },

      confirmNavigation: () => {
        const { pendingSection } = get()
        set({ ...initialState })
        return pendingSection
      },

      cancelNavigation: () => set({ pendingSection: null }),

      reset: () => set({ ...initialState }),
    }),
    { name: 'settings-dirty-store' }
  )
)
