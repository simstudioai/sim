import { PrincipalSubjectUserRequiredError } from '@sim/auth/principal'
import { InvalidInternalDelegationBindingError } from '@/lib/auth/internal-delegation'

/**
 * Identity failures that every in-process tool handler answers the same way.
 *
 * `unauthenticated` is a caller that never established a runtime identity — a
 * missing or unbindable executor delegation.
 *
 * `subject_user_required` is a caller that IS authenticated but has no human
 * subject to act as, which is the normal shape of an actorless run: a schedule,
 * or a webhook carrying no external subject. It is distinct from
 * `unauthenticated` because retrying, re-authenticating, or fixing credentials
 * cannot resolve it — the operation is simply not available to that trigger, and
 * an operator reading the log needs to be told so rather than shown a generic
 * failure. The Logs detail tools returned an opaque 500 for exactly this for one
 * evening, which is why the classification lives here rather than per handler.
 */
export type InternalToolIdentityFault = 'unauthenticated' | 'subject_user_required'

const FAULTS: Record<InternalToolIdentityFault, { status: number; message: string }> = {
  unauthenticated: { status: 401, message: 'Authentication required' },
  subject_user_required: {
    status: 403,
    message:
      'This tool requires a user identity, and this run has none — scheduled and webhook triggers run without a user',
  },
}

/** Classifies an identity fault, or returns `undefined` for any other failure. */
export function classifyInternalToolIdentityFault(
  error: unknown
): InternalToolIdentityFault | undefined {
  if (error instanceof PrincipalSubjectUserRequiredError) return 'subject_user_required'
  if (
    error instanceof InvalidInternalDelegationBindingError ||
    (error instanceof Error && error.message === 'Authentication required')
  ) {
    return 'unauthenticated'
  }
  return undefined
}

export function internalToolIdentityFaultStatus(fault: InternalToolIdentityFault): number {
  return FAULTS[fault].status
}

export function internalToolIdentityFaultMessage(fault: InternalToolIdentityFault): string {
  return FAULTS[fault].message
}
