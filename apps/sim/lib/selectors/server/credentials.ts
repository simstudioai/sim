import type { SessionPrincipal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { account, credential } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import {
  authorizeCredentialUseForAuth,
  type CredentialAccessResult,
} from '@/lib/auth/credential-access'
import { AuthType } from '@/lib/auth/hybrid'
import { resolveCredentialAccessToken } from '@/lib/oauth/credential-service'
import { credentialProviderMatchesService, getServiceConfigByServiceId } from '@/lib/oauth/utils'
import { SelectorConnectionUnavailableError } from '@/lib/selectors/server/errors'
import type {
  AuthorizedSelectorCredential,
  SelectorCredentialPolicy,
  SelectorProtectedValues,
} from '@/lib/selectors/server/types'
import type { SelectorContext, SelectorScope } from '@/lib/selectors/types'

async function credentialMatchesService(input: {
  credentialId: string
  credentialOwnerUserId: string
  serviceId: string
}): Promise<boolean> {
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

  const service = getServiceConfigByServiceId(input.serviceId)
  return Boolean(providerId && service && credentialProviderMatchesService(providerId, service))
}

async function requireCredentialProviderBinding(
  credentialId: string,
  access: CredentialAccessResult,
  serviceIds: readonly string[]
): Promise<void> {
  if (!access.credentialOwnerUserId) throw new SelectorConnectionUnavailableError()
  for (const serviceId of serviceIds) {
    if (
      await credentialMatchesService({
        credentialId,
        credentialOwnerUserId: access.credentialOwnerUserId,
        serviceId,
      })
    ) {
      return
    }
  }
  throw new SelectorConnectionUnavailableError()
}

export async function authorizeSelectorCredential(input: {
  principal: SessionPrincipal
  context: SelectorContext
  scope: SelectorScope
  workspaceId: string
  policy: SelectorCredentialPolicy
  protectedValues: SelectorProtectedValues
}): Promise<AuthorizedSelectorCredential> {
  const suppliedId = input.context[input.policy.field]
  if (!suppliedId) throw new SelectorConnectionUnavailableError()
  input.protectedValues.add(suppliedId)

  if (
    input.policy.kind === 'stored-or-fixed-token' &&
    input.policy.tokenPrefixes.some((prefix) => suppliedId.startsWith(prefix))
  ) {
    input.protectedValues.add(suppliedId)
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
    }
  )
  if (!access.ok || access.workspaceId !== input.workspaceId) {
    throw new SelectorConnectionUnavailableError()
  }
  input.protectedValues.add(access.resolvedCredentialId)

  await requireCredentialProviderBinding(suppliedId, access, input.policy.serviceIds)
  return { suppliedId, access }
}

export async function resolveSelectorOAuthAccessToken(input: {
  credential: AuthorizedSelectorCredential
  serviceId: string
  scopes?: readonly string[]
  impersonateEmail?: string
  protectedValues: SelectorProtectedValues
}): Promise<string> {
  if (input.credential.fixedToken) return input.credential.fixedToken

  const access = input.credential.access
  if (!access?.credentialOwnerUserId || !access.resolvedCredentialId) {
    throw new SelectorConnectionUnavailableError()
  }

  const result = await resolveCredentialAccessToken(
    input.credential.suppliedId,
    access.credentialOwnerUserId,
    'selector-execution',
    input.scopes ? [...input.scopes] : undefined,
    input.impersonateEmail,
    { privacyMode: 'selector' }
  )
  const token = result?.accessToken

  if (!token) throw new SelectorConnectionUnavailableError()
  input.protectedValues.add(token)
  input.protectedValues.add(result.domain)
  input.protectedValues.add(result.instanceUrl)
  input.protectedValues.add(result.apiDomain)
  return token
}
