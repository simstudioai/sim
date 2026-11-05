import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'

export type OrganizationHomeWidget = 'Activity' | 'Email' | 'Calendar'

interface OrganizationHomeState {
  /** What each viewer hid from Customize Home, keyed by user and organization. */
  hiddenWidgets: Record<string, OrganizationHomeWidget[]>
  setWidgetHidden: (viewer: string, widget: OrganizationHomeWidget, hidden: boolean) => void
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
      }),
      {
        name: 'organization-home:v1',
        partialize: (state) => ({ hiddenWidgets: state.hiddenWidgets }),
      }
    ),
    { name: 'organization-home-store' }
  )
)
