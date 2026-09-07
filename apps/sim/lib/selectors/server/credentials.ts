import type { SessionPrincipal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { account, credential } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import {
  authorizeCredentialUseForAuth,
  type CredentialAccessResult,
} from '@/lib/auth/credential-access'
import { AuthType } from '@/lib/auth/hybrid'
import {
  authorizeOrganizationCredentialUse,
  resolveOrganizationCredentialTokenBundle,
} from '@/lib/credentials/application/organization-credentials'
import { resolveCredentialTokenBundle } from '@/lib/oauth/credential-service'
import { credentialProviderMatchesService, getServiceConfigByServiceId } from '@/lib/oauth/utils'
import { SelectorConnectionUnavailableError } from '@/lib/selectors/server/errors'
import type {
  AuthorizedSelectorCredential,
  ResolvedSelectorReference,
  SelectorCredentialPolicy,
  SelectorProtectedValues,
} from '@/lib/selectors/server/types'
import type { SelectorContext, SelectorScope } from '@/lib/selectors/types'

function selectorAbortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted.', 'AbortError')
}

/**
 * Makes one selector's wait abortable without attaching its signal to shared
 * refresh or mint work that may still be serving other callers.
 */
export function waitForSelectorCredentialResolution<T>(
  resolution: Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  if (!signal) return resolution
  if (signal.aborted) return Promise.reject(selectorAbortReason(signal))

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort)
      reject(selectorAbortReason(signal))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    resolution.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      }
    )
    if (signal.aborted) onAbort()
  })
}

async function resolveCredentialProviderId(input: {
  credentialId: string
  credentialOwnerUserId: string
}): Promise<string | null> {
  const [credentialRow] = await db
    .select({ accountId: credential.accountId, providerId: credential.providerId })
    .from(credential)
    .where(eq(credential.id, input.credentialId))
    .limit(1)

  let providerId = credentialRow?.providerId ?? null
  const accountId = credentialRow?.accountId ?? input.credentialId
  if (!providerId) {
    const [accountRow] = await db
      .select({ providerId: account.providerId })
      .from(account)
      .where(and(eq(account.id, accountId), eq(account.userId, input.credentialOwnerUserId)))
      .limit(1)
    providerId = accountRow?.providerId ?? null
  }

  return providerId
}

async function requireCredentialProviderBinding(
  credentialId: string,
  access: CredentialAccessResult,
  serviceIds: readonly string[]
): Promise<string> {
  if (!access.credentialOwnerUserId) throw new SelectorConnectionUnavailableError()
  const providerId = await resolveCredentialProviderId({
    credentialId,
    credentialOwnerUserId: access.credentialOwnerUserId,
  })
  if (!providerId) throw new SelectorConnectionUnavailableError()
  for (const serviceId of serviceIds) {
    const service = getServiceConfigByServiceId(serviceId)
    if (service && credentialProviderMatchesService(providerId, service)) return providerId
  }
  throw new SelectorConnectionUnavailableError()
}

export async function authorizeSelectorCredential(input: {
  principal: SessionPrincipal
  context: SelectorContext
  scope: SelectorScope
  workspaceId?: string
  organizationId?: string
  policy: SelectorCredentialPolicy
  protectedValues: SelectorProtectedValues
  references: ReadonlyMap<string, ResolvedSelectorReference>
}): Promise<AuthorizedSelectorCredential> {
  const suppliedId = input.context[input.policy.field]
  if (!suppliedId) throw new SelectorConnectionUnavailableError()

  if (input.scope.kind === 'organization') {
    if (input.workspaceId || input.organizationId !== input.scope.organizationId)
      throw new SelectorConnectionUnavailableError()
    const { credential: row } = await authorizeOrganizationCredentialUse({
      principal: input.principal,
      organizationId: input.scope.organizationId,
      credentialId: suppliedId,
      requestId: 'selector-execution',
    })
    if (
      !row.providerId ||
      !input.policy.serviceIds.some((serviceId) => {
        const service = getServiceConfigByServiceId(serviceId)
        return service && credentialProviderMatchesService(row.providerId!, service)
      })
    )
      throw new SelectorConnectionUnavailableError()
    input.protectedValues.add(suppliedId, 'reference')
    return {
      suppliedId,
      providerId: row.providerId,
      organization: { principal: input.principal, organizationId: input.scope.organizationId },
    }
  }

  if (
    input.policy.kind === 'stored-or-fixed-token' &&
    input.policy.tokenPrefixes.some((prefix) => suppliedId.startsWith(prefix))
  ) {
    const reference = input.references.get(input.policy.field)
    if (reference && !reference.visible) {
      input.protectedValues.add(suppliedId, 'secret')
    }
    return { suppliedId, fixedToken: suppliedId }
  }

  const access = await authorizeCredentialUseForAuth(
    {
      success: true,
      userId: input.principal.userId,
      authType: AuthType.SESSION,
    },
    {
      credentialId: suppliedId,
      ...(input.scope.kind === 'workflow' ? { workflowId: input.scope.workflowId } : {}),
      ...(input.scope.kind === 'workspace' ? { workspaceId: input.workspaceId } : {}),
    }
  )
  if (!access.ok || access.workspaceId !== input.workspaceId) {
    throw new SelectorConnectionUnavailableError()
  }
  input.protectedValues.add(access.resolvedCredentialId, 'reference')

  const providerId = await requireCredentialProviderBinding(
    suppliedId,
    access,
    input.policy.serviceIds
  )
  return { suppliedId, access, providerId }
}

export async function resolveSelectorOAuthAccessToken(input: {
  credential: AuthorizedSelectorCredential
  serviceId: string
  scopes?: readonly string[]
  impersonateEmail?: string
  protectedValues: SelectorProtectedValues
  recordCredentialUse?: (providerId: string) => void
}): Promise<string> {
  input.credential.signal?.throwIfAborted()
  if (input.credential.fixedToken) return input.credential.fixedToken

  if (input.credential.organization) {
    const result = await waitForSelectorCredentialResolution(
      resolveOrganizationCredentialTokenBundle({
        ...input.credential.organization,
        credentialId: input.credential.suppliedId,
        requestId: 'selector-execution',
        requiredScopes: input.scopes ? [...input.scopes] : undefined,
        impersonateEmail: input.impersonateEmail,
        expectedProviderId: input.credential.providerId,
      }),
      input.credential.signal
    )
    input.credential.signal?.throwIfAborted()
    if (!result?.accessToken) throw new SelectorConnectionUnavailableError()
    input.protectedValues.add(result.accessToken)
    input.protectedValues.add(result.domain, 'reference')
    input.protectedValues.add(result.instanceUrl, 'reference')
    input.protectedValues.add(result.apiDomain, 'reference')
    input.recordCredentialUse?.(input.credential.providerId ?? input.serviceId)
    return result.accessToken
  }

  const access = input.credential.access
  if (!access?.credentialOwnerUserId || !access.resolvedCredentialId) {
    throw new SelectorConnectionUnavailableError()
  }

  const result = await waitForSelectorCredentialResolution(
    resolveCredentialTokenBundle(
      input.credential.suppliedId,
      access.credentialOwnerUserId,
      'selector-execution',
      input.scopes ? [...input.scopes] : undefined,
      input.impersonateEmail,
      { privacyMode: 'selector' }
    ),
    input.credential.signal
  )
  input.credential.signal?.throwIfAborted()
  const token = result?.accessToken

  if (!token) throw new SelectorConnectionUnavailableError()
  input.protectedValues.add(token)
  input.protectedValues.add(result.domain, 'reference')
  input.protectedValues.add(result.instanceUrl, 'reference')
  input.protectedValues.add(result.apiDomain, 'reference')
  input.recordCredentialUse?.(input.credential.providerId ?? input.serviceId)
  return token
}
