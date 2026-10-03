import { expect } from 'vitest'

/**
 * Asserts that a workflow validation result indicates access denied.
 */
export function expectWorkflowAccessDenied(
  result: {
    error: { message: string; status: number } | null
    session: unknown
    workflow: unknown
  },
  expectedStatus: 401 | 403 | 404 = 403
): void {
  expect(result.error).not.toBeNull()
  expect(result.error?.status).toBe(expectedStatus)
  expect(result.session).toBeNull()
  expect(result.workflow).toBeNull()
}
