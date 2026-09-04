import { ORACLE_EPM_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/credentials/client-credential-accounts/descriptors'
import type { OAuthService } from '@/lib/oauth'
import { getServiceConfigByServiceId } from '@/lib/oauth/utils'
import type { OAuthConfig, ParameterVisibility } from '@/tools/types'

interface OracleEpmAuthParameter {
  readonly type: 'string'
  readonly required: boolean
  readonly visibility: ParameterVisibility
  readonly description: string
}

export interface OracleEpmAuthParameters {
  readonly params: Readonly<{
    oauthCredential: OracleEpmAuthParameter
    accessToken: OracleEpmAuthParameter
    instanceUrl: OracleEpmAuthParameter
  }>
  readonly oauth: Readonly<OAuthConfig>
}

/**
 * Creates one child integration's service-account contract. Calling this from
 * a child module validates its registered service mapping immediately.
 */
export function createOracleEpmAuthParameters(input: {
  serviceId: OAuthService
}): OracleEpmAuthParameters {
  const service = getServiceConfigByServiceId(input.serviceId)
  if (service?.serviceAccountProviderId !== ORACLE_EPM_SERVICE_ACCOUNT_PROVIDER_ID) {
    throw new Error('Oracle EPM service is not registered with the Oracle EPM credential provider')
  }

  const oauthCredential = Object.freeze({
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'Oracle EPM integration-user credential',
  } as const)
  const accessToken = Object.freeze({
    type: 'string',
    required: true,
    visibility: 'hidden',
    description: 'Credential-resolved Oracle EPM Basic authorization value',
  } as const)
  const instanceUrl = Object.freeze({
    type: 'string',
    required: true,
    visibility: 'hidden',
    description: 'Credential-bound Oracle EPM environment URL',
  } as const)
  const params = Object.freeze({ oauthCredential, accessToken, instanceUrl })
  const oauth = Object.freeze({
    required: true,
    provider: input.serviceId,
    credentialKind: 'service-account',
    authoritativeParams: Object.freeze(['instanceUrl'] as const),
  })
  return Object.freeze({ params, oauth })
}
