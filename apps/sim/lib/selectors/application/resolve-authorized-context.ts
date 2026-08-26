import {
  type DelegatedPrincipal,
  type Principal,
  requirePrincipalSubjectUserId,
} from '@sim/auth/principal'
import {
  authorizeCredentialUseForAuth,
  type CredentialAccessResult,
} from '@/lib/auth/credential-access'
import { type AuthResult, AuthType } from '@/lib/auth/hybrid'
import { authorizeWorkspaceOperation, defineWorkspaceOperation } from '@/lib/core/application'
import { getEffectiveDecryptedEnv } from '@/lib/environment/utils'
import { resolveActiveWorkflowApplicationContext } from '@/lib/workflows/application/context'
import { loadActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'
import { resolveEnvVarReferences } from '@/executor/utils/reference-validation'

const SAFE_RESOLUTION_ERROR = 'Unable to resolve selector configuration'
const SELECTOR_DELEGATION_AUDIENCE = 'sim:selectors'

export const selectorContextOperation = defineWorkspaceOperation({
  id: 'selectors.context.resolve',
  minimumRole: 'read',
  workspaceApiKey: 'deny',
  principalKinds: ['session', 'delegated'],
  delegatedServices: ['executor'],
})

export type AuthorizedSelectorContextResult<T extends Record<string, unknown>> =
  | {
      ok: true
      context: T
      requesterUserId: string
      workspaceId: string
      credentialAccess?: CredentialAccessResult
    }
  | { ok: false; status: number; error: string }

function authResultForPrincipal(principal: Principal): AuthResult {
  return {
    success: true,
    userId: requirePrincipalSubjectUserId(principal),
    authType: principal.kind === 'session' ? AuthType.SESSION : AuthType.INTERNAL_JWT,
  }
}

function selectorDelegationWithinScope(
  principal: DelegatedPrincipal,
  workflowId: string | undefined
): boolean {
  if (!workflowId) return false
  const delegationContext = (principal as { delegationContext?: unknown }).delegationContext
  return (
    typeof delegationContext === 'object' &&
    delegationContext !== null &&
    'kind' in delegationContext &&
    delegationContext.kind === 'workflow_execution' &&
    'workflowId' in delegationContext &&
    delegationContext.workflowId === workflowId
  )
}

/**
 * Authorizes a selector request before resolving exact `{{KEY}}` references.
 * Workflowless requests are restricted to session principals whose authorized
 * credential supplies canonical workspace scope.
 */
export async function resolveAuthorizedSelectorContextForPrincipal<
  T extends Record<string, unknown>,
>(
  principal: Principal,
  input: {
    workflowId?: string
    credentialId?: string
    context: T
  }
): Promise<AuthorizedSelectorContextResult<T>> {
  let credentialAccess: CredentialAccessResult | undefined

  try {
    const requesterUserId = requirePrincipalSubjectUserId(principal)
    const auth = authResultForPrincipal(principal)
    let workspaceId: string
    let workspaceContext

    if (input.workflowId) {
      const workflowContext = await resolveActiveWorkflowApplicationContext({
        workflowId: input.workflowId,
      })
      workspaceId = workflowContext.workspaceId
      workspaceContext = workflowContext
    } else {
      if (principal.kind !== 'session' || !input.credentialId) {
        return { ok: false, status: 400, error: SAFE_RESOLUTION_ERROR }
      }
      credentialAccess = await authorizeCredentialUseForAuth(auth, {
        credentialId: input.credentialId,
      })
      if (!credentialAccess.ok || !credentialAccess.workspaceId) {
        return {
          ok: false,
          status: 403,
          error: credentialAccess.error || 'Unauthorized',
        }
      }
      workspaceId = credentialAccess.workspaceId
      workspaceContext = await loadActiveWorkspaceApplicationContext(workspaceId)
      if (!workspaceContext) return { ok: false, status: 403, error: 'Unauthorized' }
    }

    await authorizeWorkspaceOperation(principal, selectorContextOperation, workspaceContext, {
      delegation: {
        audience: SELECTOR_DELEGATION_AUDIENCE,
        isWithinScope: (delegatedPrincipal) =>
          selectorDelegationWithinScope(delegatedPrincipal, input.workflowId),
      },
    })

    if (input.credentialId && !credentialAccess) {
      credentialAccess = await authorizeCredentialUseForAuth(auth, {
        credentialId: input.credentialId,
        workflowId: input.workflowId,
      })
      if (!credentialAccess.ok || !credentialAccess.workspaceId) {
        return {
          ok: false,
          status: 403,
          error: credentialAccess.error || 'Unauthorized',
        }
      }
      if (credentialAccess.workspaceId !== workspaceId) {
        return { ok: false, status: 403, error: 'Unauthorized' }
      }
    }

    let context: T
    try {
      const environment = await getEffectiveDecryptedEnv(requesterUserId, workspaceId)
      context = resolveEnvVarReferences(input.context, environment, {
        allowEmbedded: false,
        resolveExactMatch: true,
        onMissing: 'throw',
        deep: true,
      }) as T
    } catch {
      return { ok: false, status: 400, error: SAFE_RESOLUTION_ERROR }
    }

    return {
      ok: true,
      context,
      requesterUserId,
      workspaceId,
      credentialAccess,
    }
  } catch {
    return { ok: false, status: 403, error: 'Unauthorized' }
  }
}

export { SELECTOR_DELEGATION_AUDIENCE }
