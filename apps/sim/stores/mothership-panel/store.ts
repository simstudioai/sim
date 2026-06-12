import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'

/**
 * Persisted split geometry for the Mothership surfaces, so a user's resize
 * survives view switches, route changes, and reloads. Widths are px;
 * `null` means the user never resized (CSS defaults apply). Consumers clamp
 * to the current viewport on apply — never at save time.
 */
interface MothershipPanelState {
  /** Resource panel width on the chat surface. */
  panelWidth: number | null
  /** Docked chat pane width on the workflow route. */
  chatPaneWidth: number | null
  setPanelWidth: (width: number) => void
  setChatPaneWidth: (width: number) => void
}

export const useMothershipPanelStore = create<MothershipPanelState>()(
  devtools(
    persist(
      (set) => ({
        panelWidth: null,
        chatPaneWidth: null,
        setPanelWidth: (width) => set({ panelWidth: width }),
        setChatPaneWidth: (width) => set({ chatPaneWidth: width }),
      }),
      { name: 'mothership-panel' }
    ),
    { name: 'mothership-panel-store' }
  )
)
