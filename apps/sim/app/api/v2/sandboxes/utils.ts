import { createV2ResourceConcealmentPolicy, type V2ErrorPolicy } from '@/lib/api/server/routes'
import { asOrchestrationError } from '@/lib/core/orchestration/types'
import {
  SandboxDependencyError,
  SandboxSystemPackageError,
} from '@/lib/execution/remote-sandbox/workspace-sandboxes'
import { SandboxBuildBudgetExceededError } from '@/lib/sandboxes/application/build-budget'
import { v2CaughtOrchestrationError, v2Error } from '@/app/api/v2/lib/response'

export const SANDBOX_NOT_FOUND_MESSAGE = 'Sandbox not found'

/**
 * The failures the shared projection would flatten. A refused dependency or
 * system-package line keeps its per-line `issues` under `error.details`, and a
 * spent build budget answers `429` with `Retry-After` — through `v2Error`
 * rather than `v2RateLimitError`, whose `X-RateLimit-*` headers describe the
 * API-key bucket, which is not what refused this request.
 */
export function renderSandboxError(error: unknown) {
  if (error instanceof SandboxBuildBudgetExceededError) {
    return v2Error('RATE_LIMITED', 'Sandbox build budget exceeded for this workspace', {
      headers: { 'Retry-After': String(error.retryAfterSeconds) },
      details: { retryAfter: error.resetAt.toISOString() },
    })
  }
  const classified = asOrchestrationError(error)
  if (classified instanceof SandboxSystemPackageError) {
    return v2Error('BAD_REQUEST', classified.message, {
      details: { issueField: 'systemPackages', issues: classified.issues },
    })
  }
  if (classified instanceof SandboxDependencyError) {
    return v2Error('BAD_REQUEST', classified.message, {
      details: { issueField: 'dependencies', issues: classified.issues },
    })
  }
  return v2CaughtOrchestrationError(error)
}

/**
 * The item routes answer every absence as a missing sandbox. A missing or
 * archived workspace must not read differently from a workspace the caller has
 * no reach into, or the message becomes an oracle for which workspace ids exist.
 */
function renderSandboxResourceError(error: unknown) {
  if (asOrchestrationError(error)?.code === 'not_found') {
    return v2Error('NOT_FOUND', SANDBOX_NOT_FOUND_MESSAGE)
  }
  return renderSandboxError(error)
}

export const sandboxCollectionErrorPolicy: V2ErrorPolicy = { render: renderSandboxError }

export const sandboxResourceErrorPolicy = createV2ResourceConcealmentPolicy({
  notFoundMessage: SANDBOX_NOT_FOUND_MESSAGE,
  render: renderSandboxResourceError,
})
