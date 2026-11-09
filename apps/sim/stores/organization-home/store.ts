import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import { registerUserDataReset } from '@/stores/user-data-reset-registry'

/** The legacy organization Home's key, so a choice made there still holds. */
const STORAGE_KEY = 'organization-home:v1'

/** Every widget a Customize Home menu has offered; storage may still hold a retired one. */
type OrganizationHomeWidget = 'Activity' | 'Workspaces' | 'Email' | 'Calendar'

interface OrganizationHomeState {
  /** What each viewer hid from Customize Home, keyed by user and organization. */
  hiddenWidgets: Record<string, OrganizationHomeWidget[]>
  setWidgetHidden: (viewer: string, widget: OrganizationHomeWidget, hidden: boolean) => void
  reset: () => void
}

export const useOrganizationHomeStore = create<OrganizationHomeState>()(
  devtools(
    persist(
      (set) => ({
        hiddenWidgets: {},
        setWidgetHidden: (viewer, widget, hidden) =>
          set((state) => {
            const others = (state.hiddenWidgets[viewer] ?? []).filter((item) => item !== widget)
            return {
              hiddenWidgets: {
                ...state.hiddenWidgets,
                [viewer]: hidden ? [...others, widget] : others,
              },
            }
          }),
        reset: () => set({ hiddenWidgets: {} }),
      }),
      {
        name: STORAGE_KEY,
        partialize: (state) => ({ hiddenWidgets: state.hiddenWidgets }),
      }
    ),
    { name: 'organization-home-store' }
  )
)

registerUserDataReset(STORAGE_KEY, () => {
  useOrganizationHomeStore.getState().reset()
  void useOrganizationHomeStore.persist.clearStorage()
})
