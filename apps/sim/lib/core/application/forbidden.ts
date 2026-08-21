import { OrchestrationError } from '@/lib/core/orchestration/types'

/**
 * The closed set of machine-readable causes a `403` may carry in
 * `error.details.code`.
 *
 * A 403 tells a caller only that it was refused; the cause decides what it can
 * do about it. Raising a member's role, issuing a personal key instead of a
 * workspace-scoped one, re-pointing a workspace key, and buying an enterprise
 * plan are four different remedies that were previously distinguishable only by
 * matching on prose — which makes every message reword a silent client break.
 *
 * The set is closed and exhaustive over the refusals a caller can act on, for
 * two reasons. A union type makes an unlisted spelling a compile error rather
 * than a new undocumented value on the wire, and the OpenAPI 403 description is
 * generated from these same members, so a code cannot be emitted without being
 * published.
 *
 * Deliberately absent: the cross-tenant refusals (`NoWorkspaceAccessError`,
 * `WorkspaceApiKeyScopeAuthorizationError`,
 * `DelegatedWorkspaceAuthorizationError`). Those are concealed as `404` by
 * `createV2ResourceConcealmentPolicy` precisely so a caller cannot learn that
 * the resource exists, and naming their cause would hand back the signal the
 * concealment withholds.
 */
export const FORBIDDEN_DETAIL_CODES = [
  /** The caller's workspace role is below the operation's `minimumRole`. */
  'INSUFFICIENT_WORKSPACE_ROLE',
  /** The workspace's organization has disabled personal API keys. */
  'PERSONAL_API_KEYS_DISABLED',
  /** The operation is not delegable to a workspace-scoped API key. */
  'WORKSPACE_KEY_OPERATION_NOT_PERMITTED',
  /** The operation does not accept this kind of principal at all. */
  'PRINCIPAL_KIND_NOT_PERMITTED',
  /** The caller is not a member of the organization it named. */
  'ORGANIZATION_MEMBERSHIP_REQUIRED',
  /** The caller is a member of the organization but not an admin or owner. */
  'ORGANIZATION_ADMIN_REQUIRED',
  /** The organization has no usable enterprise subscription. */
  'ENTERPRISE_PLAN_REQUIRED',
  /** The organization has no usable organization plan of any tier. */
  'ORGANIZATION_PLAN_REQUIRED',
  /** Audit logging is switched off for this deployment. */
  'AUDIT_LOGS_DISABLED',
  /** The caller holds workspace write but is not an editor of this skill. */
  'SKILL_EDITOR_ACCESS_REQUIRED',
  /** The caller holds workspace write but is not an admin of this secret. */
  'SECRET_ADMIN_ACCESS_REQUIRED',
  /** The workspace is already at its ceiling for this kind of resource. */
  'WORKSPACE_RESOURCE_LIMIT_REACHED',
  /** The workspace's organization does not permit public sharing. */
  'PUBLIC_SHARING_NOT_ALLOWED',
  /** The caller can reach the workspace but cannot administer this credential. */
  'CREDENTIAL_ADMIN_ACCESS_REQUIRED',
  /** The MCP server URL is outside the allowed domains or resolves internally. */
  'MCP_SERVER_URL_NOT_ALLOWED',
] as const

export type ForbiddenDetailCode = (typeof FORBIDDEN_DETAIL_CODES)[number]

/**
 * What each code means to a caller, in the words the generated OpenAPI 403
 * description publishes.
 *
 * The `Record` is the completeness gate: adding a member to
 * {@link FORBIDDEN_DETAIL_CODES} fails to compile until it is documented here,
 * so a code cannot reach the wire undocumented.
 */
export const FORBIDDEN_DETAIL_CODE_DESCRIPTIONS: Record<ForbiddenDetailCode, string> = {
  INSUFFICIENT_WORKSPACE_ROLE:
    'The caller has access to the workspace but its role is below the one this operation requires.',
  PERSONAL_API_KEYS_DISABLED:
    "The workspace's organization does not allow personal API keys. Use a workspace API key.",
  WORKSPACE_KEY_OPERATION_NOT_PERMITTED:
    'This operation is not available to a workspace-scoped API key. Use a personal API key.',
  PRINCIPAL_KIND_NOT_PERMITTED: 'This operation does not accept the caller’s kind of API key.',
  ORGANIZATION_MEMBERSHIP_REQUIRED: 'The caller is not a member of the organization it named.',
  ORGANIZATION_ADMIN_REQUIRED:
    'The caller is a member of the organization but not an admin or owner.',
  ENTERPRISE_PLAN_REQUIRED: 'The organization has no active enterprise subscription.',
  ORGANIZATION_PLAN_REQUIRED:
    'The organization has no active organization subscription (Pro for Teams, Max for Teams, or Enterprise).',
  AUDIT_LOGS_DISABLED: 'Audit logging is not enabled for this deployment.',
  SKILL_EDITOR_ACCESS_REQUIRED:
    'The caller can write in the workspace but is not an editor of this skill.',
  SECRET_ADMIN_ACCESS_REQUIRED:
    'The caller can write in the workspace but is not an admin of this secret. Ask a workspace admin, or someone holding admin on the secret, to grant access or set the value.',
  WORKSPACE_RESOURCE_LIMIT_REACHED:
    'The workspace already holds the maximum number of resources of this kind. Delete one, or contact Sim to raise the limit; the message names the ceiling.',
  PUBLIC_SHARING_NOT_ALLOWED:
    "The workspace's organization does not permit sharing this resource publicly. An organization admin controls the policy.",
  CREDENTIAL_ADMIN_ACCESS_REQUIRED:
    'The caller can reach the workspace but cannot administer this credential.',
  MCP_SERVER_URL_NOT_ALLOWED:
    'The supplied MCP server URL is outside the allowed domains or resolves to an internal address.',
}

/**
 * A `forbidden` orchestration failure that names its cause.
 *
 * Subclasses keep their own identity so `instanceof` checks that already
 * classify a refusal — concealment, for one — keep working unchanged; the code
 * rides alongside rather than replacing the message.
 */
export class ForbiddenOperationError extends OrchestrationError {
  constructor(
    readonly detailCode: ForbiddenDetailCode,
    message: string
  ) {
    super('forbidden', message)
    this.name = 'ForbiddenOperationError'
  }
}

/**
 * The `error.details` a refusal should be rendered with, or `undefined` when the
 * failure names no cause. Applied by the v2 error projection so a route never
 * has to remember to attach it.
 */
export function forbiddenErrorDetails(error: unknown): { code: ForbiddenDetailCode } | undefined {
  return error instanceof ForbiddenOperationError ? { code: error.detailCode } : undefined
}
