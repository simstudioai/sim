import type { SandboxValidationError } from '@/lib/api/contracts/sandboxes'
import {
  createInternalResourceConcealmentPolicy,
  extendInternalErrorPolicy,
  internalErrorResponse,
  internalOrchestrationErrorPolicy,
} from '@/lib/api/server/routes'
import { asOrchestrationError } from '@/lib/core/orchestration/types'
import {
  SandboxDependencyError,
  SandboxSystemPackageError,
} from '@/lib/execution/remote-sandbox/workspace-sandboxes'
import { SandboxBuildBudgetExceededError } from '@/lib/sandboxes/application/build-budget'

export const SANDBOX_NOT_FOUND_MESSAGE = 'Sandbox not found'

/**
 * The bodies the settings editor reads. `issueField` and `issues` address a
 * refused dependency or system-package line back to the row the user typed it
 * on, and the budget refusal keeps the legacy `retryAfter` body and headers.
 * Everything else is the shared orchestration projection.
 */
export const internalSandboxErrorPolicy = extendInternalErrorPolicy(
  internalOrchestrationErrorPolicy,
  (error) => {
    if (error instanceof SandboxBuildBudgetExceededError) {
      return internalErrorResponse(
        429,
        { error: error.message, retryAfter: error.resetAt.getTime() },
        {
          'Retry-After': String(error.retryAfterSeconds),
          'X-RateLimit-Reset': error.resetAt.toISOString(),
        }
      )
    }
    const classified = asOrchestrationError(error)
    if (classified instanceof SandboxSystemPackageError) {
      const body = {
        error: classified.message,
        issueField: 'systemPackages',
        issues: classified.issues,
      } satisfies SandboxValidationError
      return internalErrorResponse(400, body)
    }
    if (classified instanceof SandboxDependencyError) {
      const body = {
        error: classified.message,
        issueField: 'dependencies',
        issues: classified.issues,
      } satisfies SandboxValidationError
      return internalErrorResponse(400, body)
    }
    return null
  }
)

/** The item routes conceal a caller with no reach into the workspace as a missing sandbox. */
export const internalSandboxResourceErrorPolicy = createInternalResourceConcealmentPolicy({
  base: internalSandboxErrorPolicy,
  notFoundMessage: SANDBOX_NOT_FOUND_MESSAGE,
})
