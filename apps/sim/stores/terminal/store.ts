import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Display mode type for terminal output
 */
// export type DisplayMode = 'raw' | 'prettier'

/**
 * Terminal state interface
 */
interface TerminalState {
  terminalHeight: number
  setTerminalHeight: (height: number) => void
  outputPanelWidth: number
  setOutputPanelWidth: (width: number) => void
  // displayMode: DisplayMode
  // setDisplayMode: (mode: DisplayMode) => void
  _hasHydrated: boolean
  setHasHydrated: (hasHydrated: boolean) => void
}

/**
 * Terminal height constraints
 * Note: Maximum height is enforced dynamically at 70% of viewport height in the resize hook
 */
const MIN_TERMINAL_HEIGHT = 30
export const DEFAULT_TERMINAL_HEIGHT = 145

/**
 * Output panel width constraints
 */
const MIN_OUTPUT_PANEL_WIDTH = 300
const DEFAULT_OUTPUT_PANEL_WIDTH = 400

/**
 * Default display mode
 */
// const DEFAULT_DISPLAY_MODE: DisplayMode = 'prettier'

export const useTerminalStore = create<TerminalState>()(
  persist(
    (set) => ({
      terminalHeight: DEFAULT_TERMINAL_HEIGHT,
      setTerminalHeight: (height) => {
        // Only enforce minimum - maximum is enforced dynamically by the resize hook
        const clampedHeight = Math.max(MIN_TERMINAL_HEIGHT, height)
        set({ terminalHeight: clampedHeight })
        // Update CSS variable for immediate visual feedback
        if (typeof window !== 'undefined') {
          document.documentElement.style.setProperty('--terminal-height', `${clampedHeight}px`)
        }
      },
      outputPanelWidth: DEFAULT_OUTPUT_PANEL_WIDTH,
      setOutputPanelWidth: (width) => {
        const clampedWidth = Math.max(MIN_OUTPUT_PANEL_WIDTH, width)
        set({ outputPanelWidth: clampedWidth })
      },
      // displayMode: DEFAULT_DISPLAY_MODE,
      // setDisplayMode: (mode) => {
      //   set({ displayMode: mode })
      // },
      _hasHydrated: false,
      setHasHydrated: (hasHydrated) => {
        set({ _hasHydrated: hasHydrated })
      },
    }),
    {
      name: 'terminal-state',
      onRehydrateStorage: () => (state) => {
        // Sync CSS variables with stored state after rehydration
        if (state && typeof window !== 'undefined') {
          document.documentElement.style.setProperty(
            '--terminal-height',
            `${state.terminalHeight}px`
          )
        }
      },
    }
  )
)
