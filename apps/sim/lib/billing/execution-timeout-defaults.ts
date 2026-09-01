export const MAX_WORKFLOW_EXECUTION_TIMEOUT_SECONDS = 7 * 24 * 60 * 60
export const DEFAULT_ENTERPRISE_WORKFLOW_EXECUTION_TIMEOUT_SECONDS = 90 * 60

export function parseWorkflowExecutionTimeoutSeconds(value: unknown): number | null {
  const parsed =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN

  if (
    !Number.isSafeInteger(parsed) ||
    parsed < 1 ||
    parsed > MAX_WORKFLOW_EXECUTION_TIMEOUT_SECONDS
  ) {
    return null
  }

  return parsed
}

/** Resolves the operator-configured Enterprise fallback through the hosted policy bounds. */
export function resolveEnterpriseWorkflowExecutionTimeoutFallbackSeconds(value: unknown): number {
  return (
    parseWorkflowExecutionTimeoutSeconds(value) ??
    DEFAULT_ENTERPRISE_WORKFLOW_EXECUTION_TIMEOUT_SECONDS
  )
}
