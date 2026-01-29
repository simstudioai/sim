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
export interface TerminalState {
  terminalHeight: number
  setTerminalHeight: (height: number) => void
  lastExpandedHeight: number
  outputPanelWidth: number
  setOutputPanelWidth: (width: number) => void
  openOnRun: boolean
  setOpenOnRun: (open: boolean) => void
  wrapText: boolean
  setWrapText: (wrap: boolean) => void
  structuredView: boolean
  setStructuredView: (structured: boolean) => void
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
