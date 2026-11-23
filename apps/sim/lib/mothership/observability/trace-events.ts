// Sim-owned: edit here; the mothership worker does not sync this file.

// Canonical mothership OTel span event names Sim emits. Call sites reference
// `TraceEvent.<Identifier>` rather than raw strings so typos are compile errors.

export const TraceEvent = {
  CopilotDbTransactionBodyComplete: 'copilot.db.transaction.body_complete',
  CopilotDbTransactionReady: 'copilot.db.transaction.ready',
  CopilotOutputFileError: 'copilot.output_file.error',
  CopilotSseFirstEvent: 'copilot.sse.first_event',
  CopilotSseIdleGapExceeded: 'copilot.sse.idle_gap_exceeded',
  CopilotSseTerminalEventReceived: 'copilot.sse.terminal_event_received',
  CopilotTableError: 'copilot.table.error',
  RequestCancelled: 'request.cancelled',
} as const
