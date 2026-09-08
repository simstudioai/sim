import { isUserCredentialPrincipal, type Principal } from '@sim/auth/principal'
import type { AuditLogOperation, AuditLogPrincipal } from '@/lib/audit-logs/application/operations'
import {
  resolveDefaultAuditOrganization,
  resolveEnterpriseAuditAccess,
} from '@/lib/audit-logs/authorization'
import { SIM_CLI_CLIENT_ID } from '@/lib/auth/oauth-provider'
import {
  ForbiddenOperationError,
  type OperationUseCase,
  PersonalApiKeysDisabledError,
} from '@/lib/core/application'
import { requireOAuthOperationScope } from '@/lib/core/application/oauth-authorization'
import { refuseCapability } from '@/lib/permission-groups/capabilities'
import { isCapabilityWithheldForUser } from '@/lib/permission-groups/user-scope.server'

export interface AuthorizedAuditLogContext {
  organizationId: string
  orgMemberIds: string[]
  actorUserId: string
}

interface AuthorizedAuditLogDefinition<O extends AuditLogOperation, I, R> {
  operation: O
  organizationId(input: I): string | undefined
  execute(args: {
    principal: AuditLogPrincipal
    input: I
    context: AuthorizedAuditLogContext
  }): Promise<R>
}

function requireAuditLogPrincipal(
  principal: Principal,
  operation: AuditLogOperation
): asserts principal is AuditLogPrincipal {
  if (!operation.principalKinds.some((kind) => kind === principal.kind)) {
    throw new ForbiddenOperationError(
      'PRINCIPAL_KIND_NOT_PERMITTED',
      `Principal kind ${principal.kind} cannot perform operation ${operation.id}`
    )
  }
}

function auditActorUserId(principal: AuditLogPrincipal): string {
  return principal.userId
}

/**
 * The organization the read applies to: the one the caller named, or its single
 * membership when it named none.
 *
 * The derivation has no ambiguous case to refuse. `member` carries
 * `uniqueIndex('member_user_id_unique').on(member.userId)`, so an actor holds
 * at most one membership row; the caller either has one organization or none.
 * The lookup is keyed on the caller's own user id, so it can only ever resolve
 * an organization the caller is already a member of.
 */
async function resolveOperationOrganizationId(
  actorUserId: string,
  requestedOrganizationId: string | undefined
): Promise<string> {
  if (requestedOrganizationId) return requestedOrganizationId

  const resolved = await resolveDefaultAuditOrganization(actorUserId)
  if (resolved.kind === 'none') {
    throw new ForbiddenOperationError(
      'ORGANIZATION_MEMBERSHIP_REQUIRED',
      'Not a member of any organization'
    )
  }
  return resolved.organizationId
}

export function defineAuthorizedAuditLogUseCase<const O extends AuditLogOperation, I, R>(
  definition: AuthorizedAuditLogDefinition<O, I, R>
): OperationUseCase<O, I, R> {
  return {
    operation: definition.operation,
    async execute({ principal, input }) {
      requireAuditLogPrincipal(principal, definition.operation)
      requireOAuthOperationScope(principal, definition.operation)
      const actorUserId = auditActorUserId(principal)
      if (
        isUserCredentialPrincipal(principal) &&
        (await isCapabilityWithheldForUser(actorUserId, 'personal_api_key.use'))
      ) {
        throw new PersonalApiKeysDisabledError()
      }
      /**
       * permission-group-enforced: personal_api_key.use, cli.use — this path
       * authorizes against an organization rather than a workspace, so the
       * workspace-keyed funnel never runs. The user-global form is the policy
       * that applies when there is no workspace key.
       */
      if (
        principal.kind === 'oauth_access_token' &&
        principal.clientId === SIM_CLI_CLIENT_ID &&
        (await isCapabilityWithheldForUser(actorUserId, 'cli.use'))
      ) {
        refuseCapability('cli.use')
      }
      const organizationId = await resolveOperationOrganizationId(
        actorUserId,
        definition.organizationId(input)
      )
      const access = await resolveEnterpriseAuditAccess(actorUserId, organizationId)
      if (!access.success) throw new ForbiddenOperationError(access.code, access.message)
      return definition.execute({
        principal,
        input,
        context: { ...access.context, actorUserId },
      })
    },
  }
}
