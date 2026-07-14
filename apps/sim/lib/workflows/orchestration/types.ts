export type OrchestrationErrorCode = 'validation' | 'not_found' | 'conflict' | 'internal'

/**
 * Maps an orchestration error code to its HTTP status. Shared by every route
 * surface (UI, v1, tool routes) so deployment errors map identically.
 */
export function statusForOrchestrationError(code: OrchestrationErrorCode | undefined): number {
  if (code === 'validation') return 400
  if (code === 'not_found') return 404
  if (code === 'conflict') return 409
  return 500
}
