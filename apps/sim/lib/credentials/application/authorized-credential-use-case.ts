import type { Principal } from '@sim/auth/principal'
import {
  type AuthorizedWorkspaceUseCaseDefinition,
  defineAuthorizedWorkspaceUseCase,
  ForbiddenOperationError,
  type WorkspaceAuthorizationContext,
} from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { CredentialActorContext } from '@/lib/credentials/access'
import { getCredentialActorContext } from '@/lib/credentials/access'
import {
  credentialDelegationPolicy,
  requireCredentialExecutionUserId,
} from '@/lib/credentials/application/authorization'
import type { CredentialOperation } from '@/lib/credentials/application/operations'
import type { CredentialRow } from '@/lib/credentials/queries'

export interface CredentialAuthorizationContext extends WorkspaceAuthorizationContext {
  credential: CredentialRow
  credentialAccess?: CredentialActorContext
}

export class CredentialAccessRequiredError extends OrchestrationError {
  constructor() {
    super('forbidden', 'Credential access required')
    this.name = 'CredentialAccessRequiredError'
  }
}

export function requireCredentialAccess(
  context: CredentialAuthorizationContext
): CredentialActorContext {
  if (!context.credentialAccess) {
    throw new Error('Credential use case executed without resource authorization')
  }
  return context.credentialAccess
}

/**
 * Refuses a credential type the acting principal's surface cannot represent.
 *
 * A session is a human in the credentials settings UI, which renders every type
 * including the two environment-secret ones. Copilot is confined to OAuth
 * connections. An API key reaches only the two types the public API publishes:
 * `v2CredentialTypeSchema` declares `oauth | service_account` and
 * `toV2Credential` throws on anything else, so admitting an `env_workspace` row
 * would turn a well-formed request into a caller-reachable 500 — the highest
 * severity class of defect on the v2 surface.
 *
 * Lives here, beside the resource-role check, so every credential-scoped
 * operation applies one table rather than each use case restating it.
 */
export function requireManageableCredentialType(
  principal: Principal,
  credential: Pick<CredentialRow, 'type'>
): void {
  const allowedTypes =
    principal.kind === 'session'
      ? ['oauth', 'env_workspace', 'env_personal', 'service_account', 'personal_token']
      : principal.kind === 'delegated'
        ? ['oauth']
        : ['oauth', 'service_account']
  if (!allowedTypes.includes(credential.type)) {
    throw new OrchestrationError(
      'validation',
      `Only ${allowedTypes.join(', ')} credentials can be managed by this caller`
    )
  }
}

type AuthorizedCredentialUseCaseDefinition<
  O extends CredentialOperation,
  I,
  C extends CredentialAuthorizationContext,
  R,
> = Omit<
  AuthorizedWorkspaceUseCaseDefinition<O, I, C, R>,
  'authorizationOptions' | 'authorizeResource'
>

export function defineAuthorizedCredentialUseCase<
  const O extends CredentialOperation,
  I,
  C extends CredentialAuthorizationContext,
  R,
>(definition: AuthorizedCredentialUseCaseDefinition<O, I, C, R>) {
  return defineAuthorizedWorkspaceUseCase({
    ...definition,
    authorizationOptions: { delegation: credentialDelegationPolicy },
    async authorizeResource({ principal, context }) {
      const actor = await getCredentialActorContext(
        context.credential.id,
        requireCredentialExecutionUserId(principal),
        { workspaceId: context.workspaceId }
      )
      if (
        !actor.credential ||
        !(
          actor.credential.workspaceId === context.workspaceId ||
          (actor.credential.type === 'personal_token' &&
            !actor.credential.workspaceId &&
            actor.credential.organizationId === context.workspaceOrganizationId &&
            Boolean(context.workspaceOrganizationId))
        ) ||
        !actor.hasWorkspaceAccess
      ) {
        throw new OrchestrationError('not_found', 'Credential not found')
      }
      context.credentialAccess = actor
      switch (definition.operation.minimumCredentialRole) {
        case 'member':
          if (!actor.member && !actor.isAdmin) {
            throw new CredentialAccessRequiredError()
          }
          return
        case 'admin':
          if (!actor.isAdmin) {
            throw new ForbiddenOperationError(
              'CREDENTIAL_ADMIN_ACCESS_REQUIRED',
              'Credential admin permission required'
            )
          }
          return
        default:
          throw new Error(
            `Unsupported credential role: ${definition.operation.minimumCredentialRole}`
          )
      }
    },
  })
}
