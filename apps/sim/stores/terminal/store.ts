import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { OUTPUT_PANEL_WIDTH, TERMINAL_HEIGHT } from '@/stores/constants'
import type { TerminalState } from './types'

export const useTerminalStore = create<TerminalState>()(
  persist(
    (set) => ({
      terminalHeight: TERMINAL_HEIGHT.DEFAULT,
      lastExpandedHeight: TERMINAL_HEIGHT.DEFAULT,
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
        const clampedHeight = Math.max(TERMINAL_HEIGHT.MIN, height)

        set((state) => ({
          terminalHeight: clampedHeight,
          lastExpandedHeight:
            clampedHeight > TERMINAL_HEIGHT.MIN ? clampedHeight : state.lastExpandedHeight,
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
      outputPanelWidth: OUTPUT_PANEL_WIDTH.DEFAULT,
      /**
       * Updates the output panel width, enforcing the minimum constraint.
       *
       * @param width - Desired width in pixels for the output panel.
       */
      setOutputPanelWidth: (width) => {
        const clampedWidth = Math.max(OUTPUT_PANEL_WIDTH.MIN, width)
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
      structuredView: true,
      /**
       * Enables or disables structured view mode in the output panel.
       *
       * @param structured - Whether output should be displayed as nested blocks.
       */
      setStructuredView: (structured) => {
        set({ structuredView: structured })
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
