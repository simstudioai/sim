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
  _hasHydrated: boolean
  setHasHydrated: (hasHydrated: boolean) => void
}
