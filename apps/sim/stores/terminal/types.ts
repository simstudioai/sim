/**
 * Display mode type for terminal output.
 *
 * @remarks
 * Currently unused but kept for future customization of terminal rendering.
 */
// export type DisplayMode = 'raw' | 'prettier'

/** Available views in the workflow terminal. */
export type TerminalView = 'logs' | 'evals'

/** One-shot request for a workflow terminal to reveal a specific view. */
export interface RequestedTerminalView {
  workflowId: string
  view: TerminalView
}

/** Transient error-ring override for blocks implicated by a selected eval result. */
export interface EvalErrorHighlight {
  workflowId: string
  blockIds: string[]
}

/** Terminal UI state. Durable preferences are selected by the store's persistence layer. */
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
  requestedTerminalView: RequestedTerminalView | null
  requestTerminalView: (workflowId: string, view: TerminalView) => void
  clearRequestedTerminalView: (workflowId: string) => void
  evalErrorHighlight: EvalErrorHighlight | null
  setEvalErrorHighlight: (workflowId: string, blockIds: readonly string[]) => void
  clearEvalErrorHighlight: () => void
  _hasHydrated: boolean
  setHasHydrated: (hasHydrated: boolean) => void
}
