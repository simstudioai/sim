import type { IntegrationAvailabilityResponse } from '@/lib/api/contracts/common'
import {
  asServiceAccountProviderId,
  getServiceAccountConnectNoun,
  getServiceAccountGatingBlockType,
} from '@/lib/credentials/service-account-provider-ids'
import {
  getIntegrationsForCredentialProvider,
  getServiceAccountFamilyName,
} from '@/lib/integrations/credential-display'
import { getServiceAccountProviderForProviderId } from '@/lib/oauth/utils'
import type { ConnectorMeta } from '@/connectors/types'
import { hasServiceAccountForm } from '@/platform/lib/data/credentials'

/** What a connector's account picker needs to offer adding a service account. */
export interface ConnectorServiceAccount {
  serviceAccountProviderId: string
  /** The vendor the setup dialog is titled with, such as "Atlassian" for a Jira source. */
  serviceName: string
  /** The picker option, naming the credential the provider collects ("Add service account"). */
  label: string
  /** A Confluence source sets up a Confluence key, with its own setup guide. */
  atlassianProduct?: 'confluence'
  atlassianSetupGuideUrl?: string
}

interface ConnectorServiceAccountInput {
  connectorConfig: ConnectorMeta | null | undefined
  /** The connector's OAuth provider id, resolved from its auth service. */
  providerId: string | null
  /** Where the connector may sync as a service account: a search index, or OAuth not allowed. */
  offered: boolean
  /** New setup also requires the integration to be deployed; an existing connector's settings do not. */
  integrationAvailability?: ReadonlyMap<string, IntegrationAvailabilityResponse>
  /** The search setup guide, whose service-account section a Confluence key links to. */
  docsUrl?: string
}

/**
 * The service account a connector's account picker offers to add, as the legacy pickers do: only
 * where the connector may sync as one, for new setup only while its integration is deployed, and
 * only for a provider whose setup form exists here. A provider gated on a block (the custom Slack bot) is left
 * out; a Slack source connects through its credential group instead.
 */
export function connectorServiceAccount({
  connectorConfig,
  providerId,
  offered,
  integrationAvailability,
  docsUrl,
}: ConnectorServiceAccountInput): ConnectorServiceAccount | null {
  if (!offered || !connectorConfig || !providerId) return null
  const serviceAccountProviderId = asServiceAccountProviderId(
    getServiceAccountProviderForProviderId(providerId)
  )
  if (
    !serviceAccountProviderId ||
    getServiceAccountGatingBlockType(serviceAccountProviderId) ||
    !hasServiceAccountForm(serviceAccountProviderId)
  )
    return null
  if (integrationAvailability) {
    const deploymentType =
      getIntegrationsForCredentialProvider(providerId)[0]?.type ?? connectorConfig.id
    const state = integrationAvailability.get(deploymentType.toLowerCase())?.state
    if (state !== 'ready' && state !== 'limited') return null
  }
  const confluence = connectorConfig.id === 'confluence'
  return {
    serviceAccountProviderId,
    serviceName: getServiceAccountFamilyName(serviceAccountProviderId) ?? connectorConfig.name,
    label: `Add ${getServiceAccountConnectNoun(serviceAccountProviderId)}`,
    atlassianProduct: confluence ? 'confluence' : undefined,
    atlassianSetupGuideUrl:
      confluence && docsUrl ? `${docsUrl}#using-a-service-account` : undefined,
  }
}
