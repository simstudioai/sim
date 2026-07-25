import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

interface SettingsDirtyStore {
  isDirty: boolean
  /** Leave action deferred until the user confirms discard. */
  pendingLeave: (() => void) | null
  setDirty: (dirty: boolean) => void
  /**
   * Call before leaving the current settings surface. If clean, runs `leave` immediately
   * and returns `true`. If dirty, stashes `leave` and returns `false` so the shared
   * discard dialog can confirm before running it.
   */
  requestLeave: (leave: () => void) => boolean
  /** Clears dirty + pending state and runs the deferred leave action. */
  confirmLeave: () => void
  /** Cancels a pending leave without clearing dirty state. */
  cancelLeave: () => void
  /** Resets all state — call on component unmount. */
  reset: () => void
}

const initialState = {
  isDirty: false,
  pendingLeave: null as (() => void) | null,
}

export const useSettingsDirtyStore = create<SettingsDirtyStore>()(
  devtools(
    (set, get) => ({
      ...initialState,

      setDirty: (dirty) => set({ isDirty: dirty }),

      requestLeave: (leave) => {
        if (!get().isDirty) {
          leave()
          return true
        }
        set({ pendingLeave: leave })
        return false
      },

      confirmLeave: () => {
        const { pendingLeave } = get()
        set({ ...initialState })
        pendingLeave?.()
      },

      cancelLeave: () => set({ pendingLeave: null }),

      reset: () => set({ ...initialState }),
    }),
    { name: 'settings-dirty-store' }
  )
)
