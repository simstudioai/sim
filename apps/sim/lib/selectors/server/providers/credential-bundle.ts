import {
  resolveCredentialAccessToken,
  type ServiceAccountTokenResult,
} from '@/lib/oauth/credential-service'
import { SelectorConnectionUnavailableError } from '@/lib/selectors/server/errors'
import type {
  AuthorizedSelectorCredential,
  SelectorProtectedValues,
} from '@/lib/selectors/server/types'

/**
 * Resolves credentials whose service-account variants need provider metadata in
 * addition to the access token (for example Atlassian's cloud id).
 */
export async function resolveSelectorCredentialBundle(input: {
  credential: AuthorizedSelectorCredential | undefined
  scopes?: readonly string[]
  impersonateEmail?: string
  protectedValues: SelectorProtectedValues
}): Promise<ServiceAccountTokenResult> {
  const credential = input.credential
  if (!credential) throw new SelectorConnectionUnavailableError()

  if (credential.fixedToken) {
    input.protectedValues.add(credential.fixedToken)
    return { accessToken: credential.fixedToken }
  }

  const ownerUserId = credential.access?.credentialOwnerUserId
  if (!ownerUserId) throw new SelectorConnectionUnavailableError()

  let bundle: ServiceAccountTokenResult | null
  try {
    bundle = await resolveCredentialAccessToken(
      credential.suppliedId,
      ownerUserId,
      'selector-execution',
      input.scopes ? [...input.scopes] : undefined,
      input.impersonateEmail,
      { privacyMode: 'selector' }
    )
  } catch {
    throw new SelectorConnectionUnavailableError()
  }
  if (!bundle?.accessToken) throw new SelectorConnectionUnavailableError()

  input.protectedValues.add(bundle.accessToken)
  input.protectedValues.add(bundle.cloudId)
  input.protectedValues.add(bundle.domain)
  input.protectedValues.add(bundle.instanceUrl)
  input.protectedValues.add(bundle.apiDomain)
  return bundle
}
