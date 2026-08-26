import type { Principal } from '@sim/auth/principal'
import type { NextRequest } from 'next/server'
import {
  createInternalSessionOrExecutorAuth,
  InternalUnauthenticatedError,
} from '@/lib/api/server/routes'
import {
  type AuthorizedSelectorContextResult,
  resolveAuthorizedSelectorContextForPrincipal,
  SELECTOR_DELEGATION_AUDIENCE,
} from '@/lib/selectors/application/resolve-authorized-context'

const selectorRequestAuth = createInternalSessionOrExecutorAuth({
  audience: SELECTOR_DELEGATION_AUDIENCE,
})

export type SelectorRequestAuthenticationResult =
  | { ok: true; principal: Principal }
  | { ok: false; status: 401; error: string }

/** Authenticates selector requests before request parsing or protected work. */
export async function authenticateSelectorRequest(
  request: NextRequest
): Promise<SelectorRequestAuthenticationResult> {
  try {
    return { ok: true, principal: await selectorRequestAuth.authenticate(request, {}) }
  } catch (error) {
    if (error instanceof InternalUnauthenticatedError) {
      return { ok: false, status: 401, error: error.message }
    }
    throw error
  }
}

/** Enters the surface-neutral selector-context application operation. */
export async function resolveAuthorizedSelectorContext<T extends Record<string, unknown>>(
  principal: Principal,
  input: {
    workflowId?: string
    credentialId?: string
    context: T
  }
): Promise<AuthorizedSelectorContextResult<T>> {
  return resolveAuthorizedSelectorContextForPrincipal(principal, input)
}
