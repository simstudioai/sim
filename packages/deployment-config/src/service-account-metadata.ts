import {
  CREDENTIAL_CONFIGURED_OAUTH_SERVICE_IDS,
  SERVICE_ACCOUNT_PROVIDER_BY_OAUTH_SERVICE_ID,
} from './service-account-providers.generated'

export { CREDENTIAL_CONFIGURED_OAUTH_SERVICE_IDS }

type DeploymentRequirement = 'preview-gated' | 'oauth-client'
type ServiceAccountOAuthServiceId = keyof typeof SERVICE_ACCOUNT_PROVIDER_BY_OAUTH_SERVICE_ID

export interface ServiceAccountMetadata {
  providerId: string
  deploymentRequirement?: DeploymentRequirement
}

/** Handwritten deployment policy layered over generated OAuth registry facts. */
const DEPLOYMENT_REQUIREMENT_BY_OAUTH_SERVICE_ID = {
  trello: 'oauth-client',
} as const satisfies Partial<Record<ServiceAccountOAuthServiceId, DeploymentRequirement>>

function getDeploymentRequirement(oauthServiceId: string): DeploymentRequirement | undefined {
  if (!Object.hasOwn(DEPLOYMENT_REQUIREMENT_BY_OAUTH_SERVICE_ID, oauthServiceId)) return undefined
  return DEPLOYMENT_REQUIREMENT_BY_OAUTH_SERVICE_ID[
    oauthServiceId as keyof typeof DEPLOYMENT_REQUIREMENT_BY_OAUTH_SERVICE_ID
  ]
}

function buildServiceAccountMetadata(): Readonly<Record<string, ServiceAccountMetadata>> {
  const metadata: Record<string, ServiceAccountMetadata> = {}
  for (const [oauthServiceId, providerId] of Object.entries(
    SERVICE_ACCOUNT_PROVIDER_BY_OAUTH_SERVICE_ID
  )) {
    const deploymentRequirement = getDeploymentRequirement(oauthServiceId)
    metadata[oauthServiceId] = {
      providerId,
      ...(deploymentRequirement ? { deploymentRequirement } : {}),
    }
  }
  return metadata
}

/** Lightweight deployment metadata safe to consume outside the application graph. */
export const SERVICE_ACCOUNT_METADATA_BY_OAUTH_SERVICE_ID = buildServiceAccountMetadata()

export function getServiceAccountMetadata(
  oauthServiceId: string
): ServiceAccountMetadata | undefined {
  if (!Object.hasOwn(SERVICE_ACCOUNT_METADATA_BY_OAUTH_SERVICE_ID, oauthServiceId)) {
    return undefined
  }
  return SERVICE_ACCOUNT_METADATA_BY_OAUTH_SERVICE_ID[oauthServiceId]
}
