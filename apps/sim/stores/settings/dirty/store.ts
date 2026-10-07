import { omit } from '@sim/utils/object'
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

interface SettingsGuardState {
  isDirty: boolean
  navigationBlocked: boolean
  onDiscard?: () => void
}

interface SettingsDirtyStore {
  isDirty: boolean
  navigationBlocked: boolean
  guards: Record<string, SettingsGuardState>
  /** Leave action deferred until the user confirms discard. */
  pendingLeave: (() => void) | null
  setGuard: (id: string, guard: SettingsGuardState) => void
  removeGuard: (id: string) => void
  /**
   * Call before leaving the current settings surface. If clean, runs `leave` immediately
   * and returns `true`. If dirty, stashes `leave` and returns `false` so the shared
   * discard dialog can confirm before running it.
   */
  requestLeave: (leave: () => void) => boolean
  /** Discards registered drafts and runs the deferred leave action. */
  confirmLeave: () => void
  /** Cancels a pending leave without clearing dirty state. */
  cancelLeave: () => void
  /** Resets the entire settings surface. Individual editors remove their own guard. */
  reset: () => void
}

const initialState = {
  isDirty: false,
  navigationBlocked: false,
  guards: {} as Record<string, SettingsGuardState>,
  pendingLeave: null as (() => void) | null,
}

function summarizeGuards(guards: Record<string, SettingsGuardState>) {
  const values = Object.values(guards)
  const isDirty = values.some((guard) => guard.isDirty)
  const navigationBlocked = values.some((guard) => guard.navigationBlocked)
  return {
    guards,
    isDirty,
    navigationBlocked,
    ...(!isDirty || navigationBlocked ? { pendingLeave: null } : {}),
  }
}

export const useSettingsDirtyStore = create<SettingsDirtyStore>()(
  devtools(
    (set, get) => ({
      ...initialState,

      setGuard: (id, guard) => set((state) => summarizeGuards({ ...state.guards, [id]: guard })),

      removeGuard: (id) => set((state) => summarizeGuards(omit(state.guards, [id]))),

      requestLeave: (leave) => {
        if (get().navigationBlocked) return false
        if (!get().isDirty) {
          leave()
          return true
        }
        set({ pendingLeave: leave })
        return false
      },

      confirmLeave: () => {
        const { navigationBlocked, pendingLeave } = get()
        if (navigationBlocked) return
        if (!pendingLeave) return
        for (const guard of Object.values(get().guards)) {
          if (guard.isDirty) guard.onDiscard?.()
        }
        set({ pendingLeave: null })
        pendingLeave()
      },

      cancelLeave: () => set({ pendingLeave: null }),

      reset: () => set({ ...initialState }),
    }),
    { name: 'settings-dirty-store' }
  )
)
