export type OrchestrationErrorCode = 'validation' | 'not_found' | 'conflict' | 'locked' | 'internal'

/**
 * Transport-neutral failure classes returned by every `lib/[resource]/orchestration`
 * module, so the UI routes, the public API, and the copilot tools map the same
 * failure to the same status.
 */
export function statusForOrchestrationError(code: OrchestrationErrorCode | undefined): number {
  if (code === 'validation') return 400
  if (code === 'not_found') return 404
  if (code === 'conflict') return 409
  if (code === 'locked') return 423
  return 500
}

/**
 * The slice of an HTTP request the audit log reads for client IP and user-agent
 * capture. Optional on every orchestration function so the non-HTTP callers —
 * copilot tools, background jobs — can omit what they do not have.
 */
export interface OrchestrationRequestContext {
  headers: { get(name: string): string | null }
}
