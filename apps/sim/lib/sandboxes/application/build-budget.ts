import { RateLimiter } from '@/lib/core/rate-limiter'
import { HttpError } from '@/lib/core/utils/http-error'
import { SANDBOX_MUTATION_LIMIT } from '@/lib/execution/remote-sandbox/workspace-sandboxes'

const rateLimiter = new RateLimiter()

/**
 * The bucket the legacy routes consumed, kept byte-identical so the budget
 * carries across the deploy and stays one budget however a mutation arrives.
 */
const budgetKey = (workspaceId: string) => `route:sandbox-mutations:workspace:${workspaceId}`

/**
 * Thrown when a workspace has spent its build budget for the window.
 *
 * An `HttpError` rather than a bare `Error` so a surface that has not mapped it
 * still answers 429 instead of 500; the mapped surfaces add `Retry-After`.
 */
export class SandboxBuildBudgetExceededError extends HttpError {
  readonly statusCode = 429

  constructor(
    readonly resetAt: Date,
    readonly retryAfterMs?: number
  ) {
    super('Rate limit exceeded')
    this.name = 'SandboxBuildBudgetExceededError'
  }

  /** Whole seconds until the bucket refills, never below one. */
  get retryAfterSeconds(): number {
    const waitMs = this.retryAfterMs ?? this.resetAt.getTime() - Date.now()
    return Math.max(1, Math.ceil(waitMs / 1000))
  }
}

/**
 * Consumes one token of the workspace's build budget or throws.
 *
 * Builds cost provider compute, so every mutation shares one per-workspace
 * budget rather than each admin getting a full allowance. This is cost
 * admission, not request-rate limiting: it runs inside the use case so the
 * internal API, the public API, and Copilot all draw on the same bucket, and it
 * runs after authorization so an unauthorized caller cannot drain it. Fails
 * open on a limiter outage, as the legacy routes did.
 */
export async function assertSandboxBuildBudget(workspaceId: string): Promise<void> {
  const budget = await rateLimiter.checkRateLimitDirect(
    budgetKey(workspaceId),
    SANDBOX_MUTATION_LIMIT
  )
  if (budget.allowed) return
  throw new SandboxBuildBudgetExceededError(budget.resetAt, budget.retryAfterMs)
}
