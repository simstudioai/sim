/** How a copilot request ended, shared by the lifecycle, finalization and OTel root spans. */
export const RequestTraceOutcome = {
  success: 'success',
  error: 'error',
  cancelled: 'cancelled',
} as const

export type RequestTraceOutcome = (typeof RequestTraceOutcome)[keyof typeof RequestTraceOutcome]
