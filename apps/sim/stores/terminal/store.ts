import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Display mode type for terminal output.
 *
 * @remarks
 * Currently unused but kept for future customization of terminal rendering.
 */
// export type DisplayMode = 'raw' | 'prettier'

/**
 * Terminal state persisted across workspace sessions.
 */
interface TerminalState {
  terminalHeight: number
  setTerminalHeight: (height: number) => void
  lastExpandedHeight: number
  outputPanelWidth: number
  setOutputPanelWidth: (width: number) => void
  openOnRun: boolean
  setOpenOnRun: (open: boolean) => void
  wrapText: boolean
  setWrapText: (wrap: boolean) => void
  /**
   * Indicates whether the terminal is currently being resized via mouse drag.
   *
   * @remarks
   * This flag is used by other workspace UI elements (e.g. notifications,
   * diff controls) to temporarily disable position transitions while the
   * terminal height is actively changing, avoiding janky animations.
   */
  isResizing: boolean
  /**
   * Updates the {@link TerminalState.isResizing} flag.
   *
   * @param isResizing - True while the terminal is being resized.
   */
  setIsResizing: (isResizing: boolean) => void
  _hasHydrated: boolean
  setHasHydrated: (hasHydrated: boolean) => void
}

/**
 * Terminal height constraints.
 *
 * @remarks
 * The maximum height is enforced dynamically at 70% of the viewport height
 * inside the resize hook to keep the workflow canvas visible.
 */
export const MIN_TERMINAL_HEIGHT = 30
export const DEFAULT_TERMINAL_HEIGHT = 196

/**
 * Output panel width constraints.
 */
const MIN_OUTPUT_PANEL_WIDTH = 440
const DEFAULT_OUTPUT_PANEL_WIDTH = 440

/**
 * Default display mode for terminal output.
 */
// const DEFAULT_DISPLAY_MODE: DisplayMode = 'prettier'

export const useTerminalStore = create<TerminalState>()(
  persist(
    (set) => ({
      terminalHeight: DEFAULT_TERMINAL_HEIGHT,
      lastExpandedHeight: DEFAULT_TERMINAL_HEIGHT,
      isResizing: false,
      /**
       * Updates the terminal height and synchronizes the CSS custom property.
       *
       * @remarks
       * - Enforces a minimum height to keep the resize handle usable.
       * - Persists {@link TerminalState.lastExpandedHeight} only when the
       *   height is expanded above the minimum.
       *
       * @param height - Desired terminal height in pixels.
       */
      setTerminalHeight: (height) => {
        const clampedHeight = Math.max(MIN_TERMINAL_HEIGHT, height)

        set((state) => ({
          terminalHeight: clampedHeight,
          lastExpandedHeight:
            clampedHeight > MIN_TERMINAL_HEIGHT ? clampedHeight : state.lastExpandedHeight,
        }))

        // Update CSS variable for immediate visual feedback
        if (typeof window !== 'undefined') {
          document.documentElement.style.setProperty('--terminal-height', `${clampedHeight}px`)
        }
      },
      /**
       * Updates the terminal resize state used to coordinate layout transitions.
       *
       * @param isResizing - True while the terminal is being resized via mouse drag.
       */
      setIsResizing: (isResizing) => {
        set({ isResizing })
      },
      outputPanelWidth: DEFAULT_OUTPUT_PANEL_WIDTH,
      /**
       * Updates the output panel width, enforcing the minimum constraint.
       *
       * @param width - Desired width in pixels for the output panel.
       */
      setOutputPanelWidth: (width) => {
        const clampedWidth = Math.max(MIN_OUTPUT_PANEL_WIDTH, width)
        set({ outputPanelWidth: clampedWidth })
      },
      openOnRun: true,
      /**
       * Enables or disables automatic terminal opening when new entries are added.
       *
       * @param open - Whether the terminal should open on new console entries.
       */
      setOpenOnRun: (open) => {
        set({ openOnRun: open })
      },
      wrapText: true,
      /**
       * Enables or disables text wrapping in the output panel.
       *
       * @param wrap - Whether output text should wrap.
       */
      setWrapText: (wrap) => {
        set({ wrapText: wrap })
      },
      /**
       * Indicates whether the terminal store has finished client-side hydration.
       */
      _hasHydrated: false,
      /**
       * Marks the store as hydrated on the client.
       *
       * @param hasHydrated - True when client-side hydration is complete.
       */
      setHasHydrated: (hasHydrated) => {
        set({ _hasHydrated: hasHydrated })
      },
    }),
    {
      name: 'terminal-state',
      /**
       * Synchronizes the `--terminal-height` CSS custom property with the
       * persisted store value after client-side rehydration.
       */
      onRehydrateStorage: () => (state) => {
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
