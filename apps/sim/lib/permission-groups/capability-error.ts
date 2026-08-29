import { type ForbiddenDetailCode, ForbiddenOperationError } from '@/lib/core/application/forbidden'
import type { PermissionGroupCapability } from '@/lib/permission-groups/capabilities'

/**
 * The caller's permission group withholds a capability the request needs.
 *
 * Carries the capability so a log line or an audit entry can name it; the
 * message names it for the caller. One detail code covers every capability
 * because the remedy is the same for all of them — the closed code set is closed
 * over remedies, not over causes.
 *
 * Lives here rather than beside the authorization funnel so the assertion
 * helpers can throw it without importing the funnel, which imports them.
 */
export class PermissionGroupCapabilityError extends ForbiddenOperationError {
  constructor(
    readonly capability: PermissionGroupCapability,
    detailCode: ForbiddenDetailCode,
    message: string
  ) {
    super(detailCode, message)
    this.name = 'PermissionGroupCapabilityError'
  }
}
