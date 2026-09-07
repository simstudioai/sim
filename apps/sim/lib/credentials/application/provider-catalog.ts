import type { Principal } from '@sim/auth/principal'
import { getBlockVisibility } from '@/lib/core/config/block-visibility'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  CLIENT_CREDENTIAL_ACCOUNT_DESCRIPTORS,
  type ClientCredentialAccountField,
} from '@/lib/credentials/client-credential-accounts/descriptors'
import {
  TOKEN_SERVICE_ACCOUNT_DESCRIPTORS,
  type TokenServiceAccountField,
} from '@/lib/credentials/token-service-accounts/descriptors'
import { createIntegrationCredentialVisibility } from '@/lib/integrations/credential-visibility.server'
import {
  allowedIntegrationTypes,
  allowedOrganizationIntegrationTypes,
  principalUserId,
} from '@/lib/integrations/principal-scope.server'
import {
  ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID,
  GOOGLE_SERVICE_ACCOUNT_PROVIDER_ID,
  type OAuthServiceMetadata,
  SLACK_CUSTOM_BOT_PROVIDER_ID,
} from '@/lib/oauth/types'
import { getAllOAuthServices, getServiceConfigByServiceId } from '@/lib/oauth/utils'

export interface CredentialProviderAuthorizationOption {
  providerId: string
  label: string
}

export interface CredentialProviderFieldOption {
  value: string
  label: string
}

export interface CredentialProviderField {
  id: string
  label: string
  placeholder: string
  required: boolean
  secret: boolean
  multiline: boolean
  requiredForAuthMethods?: string[]
  options?: CredentialProviderFieldOption[]
  hint?: string
}

interface CredentialProviderCatalogBase {
  type: 'oauth' | 'service_account'
  serviceId: string
  name: string
  description: string
  providerFamily: string
  available: boolean
}

export interface OAuthCredentialProviderCatalogEntry extends CredentialProviderCatalogBase {
  type: 'oauth'
  supportsReconnect: boolean
  authorizationOptions: CredentialProviderAuthorizationOption[]
  fields: CredentialProviderField[]
}

export interface ServiceAccountCredentialProviderCatalogEntry
  extends CredentialProviderCatalogBase {
  type: 'service_account'
  providerId: string
  docsUrl: string
  helpText?: string
  requiresClientGeneratedCredentialId: boolean
  fields: CredentialProviderField[]
}

export type CredentialProviderCatalogEntry =
  | OAuthCredentialProviderCatalogEntry
  | ServiceAccountCredentialProviderCatalogEntry

type CredentialProviderCatalogContext =
  | { workspaceId: string; workspaceOrganizationId: string | null }
  | { organizationId: string }

interface ServiceAccountDescriptor {
  name: string
  description: string
  docsUrl: string
  helpText?: string
  requiresClientGeneratedCredentialId?: boolean
  fields: CredentialProviderField[]
}

const GOOGLE_SERVICE_ACCOUNT_DOCS_URL = 'https://docs.sim.ai/integrations/google-service-account'
const ATLASSIAN_SERVICE_ACCOUNT_DOCS_URL =
  'https://docs.sim.ai/integrations/atlassian-service-account'

function providerField(
  field: TokenServiceAccountField | ClientCredentialAccountField
): CredentialProviderField {
  return {
    id: field.id,
    label: field.label,
    placeholder: field.placeholder,
    required: !('optional' in field && field.optional),
    secret: field.secret,
    multiline: 'multiline' in field && field.multiline === true,
    ...('requiredForAuthMethods' in field && field.requiredForAuthMethods
      ? { requiredForAuthMethods: [...field.requiredForAuthMethods] }
      : {}),
    ...('options' in field && field.options ? { options: [...field.options] } : {}),
    ...('hint' in field && field.hint
      ? { hint: field.hint }
      : 'hintMessage' in field && field.hintMessage
        ? { hint: field.hintMessage }
        : {}),
  }
}

function getServiceAccountDescriptor(providerId: string): ServiceAccountDescriptor {
  if (providerId === GOOGLE_SERVICE_ACCOUNT_PROVIDER_ID) {
    return {
      name: 'Google service account',
      description: 'Connect Google APIs with a service-account JSON key.',
      docsUrl: GOOGLE_SERVICE_ACCOUNT_DOCS_URL,
      fields: [
        {
          id: 'serviceAccountJson',
          label: 'JSON key',
          placeholder: 'Paste the service-account JSON key',
          required: true,
          secret: true,
          multiline: true,
        },
      ],
    }
  }
  if (providerId === ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID) {
    return {
      name: 'Atlassian service account',
      description: 'Connect Jira and Confluence with an Atlassian API token.',
      docsUrl: ATLASSIAN_SERVICE_ACCOUNT_DOCS_URL,
      fields: [
        {
          id: 'apiToken',
          label: 'API token',
          placeholder: 'Paste the API token',
          required: true,
          secret: true,
          multiline: false,
        },
        {
          id: 'domain',
          label: 'Site domain',
          placeholder: 'your-team.atlassian.net',
          required: true,
          secret: false,
          multiline: false,
        },
        {
          id: 'atlassianProduct',
          label: 'Product',
          placeholder: 'jira',
          required: false,
          secret: false,
          multiline: false,
          options: [
            { value: 'jira', label: 'Jira' },
            { value: 'confluence', label: 'Confluence' },
          ],
          hint: 'Select the product this token can access. Defaults to Jira.',
        },
      ],
    }
  }
  if (providerId === SLACK_CUSTOM_BOT_PROVIDER_ID) {
    return {
      name: 'Slack custom bot',
      description: 'Connect a reusable Slack app with its signing secret and bot token.',
      docsUrl: 'https://docs.sim.ai/integrations/slack',
      requiresClientGeneratedCredentialId: true,
      fields: [
        {
          id: 'signingSecret',
          label: 'Signing secret',
          placeholder: 'Paste the signing secret',
          required: true,
          secret: true,
          multiline: false,
        },
        {
          id: 'botToken',
          label: 'Bot token',
          placeholder: 'xoxb-...',
          required: true,
          secret: true,
          multiline: false,
        },
      ],
    }
  }

  const tokenDescriptor = Object.hasOwn(TOKEN_SERVICE_ACCOUNT_DESCRIPTORS, providerId)
    ? TOKEN_SERVICE_ACCOUNT_DESCRIPTORS[
        providerId as keyof typeof TOKEN_SERVICE_ACCOUNT_DESCRIPTORS
      ]
    : undefined
  if (tokenDescriptor) {
    return {
      name: `${tokenDescriptor.serviceLabel} ${tokenDescriptor.connectNoun}`,
      description: `Connect ${tokenDescriptor.serviceLabel} with a ${tokenDescriptor.tokenNoun}.`,
      docsUrl: tokenDescriptor.docsUrl,
      helpText: tokenDescriptor.helpText,
      fields: tokenDescriptor.fields.map(providerField),
    }
  }

  const clientDescriptor = Object.hasOwn(CLIENT_CREDENTIAL_ACCOUNT_DESCRIPTORS, providerId)
    ? CLIENT_CREDENTIAL_ACCOUNT_DESCRIPTORS[
        providerId as keyof typeof CLIENT_CREDENTIAL_ACCOUNT_DESCRIPTORS
      ]
    : undefined
  if (clientDescriptor) {
    return {
      name: `${clientDescriptor.serviceLabel} ${clientDescriptor.connectNoun}`,
      description: `Connect ${clientDescriptor.serviceLabel} with a ${clientDescriptor.connectNoun}.`,
      docsUrl: clientDescriptor.docsUrl,
      helpText: clientDescriptor.helpText,
      fields: clientDescriptor.fields.map(providerField),
    }
  }

  throw new Error(`Service-account provider ${providerId} is missing its canonical descriptor`)
}

export async function listCredentialProviderCatalog(
  principal: Principal,
  context: CredentialProviderCatalogContext,
  oauthType: 'oauth' | 'managed_oauth' = 'oauth'
): Promise<CredentialProviderCatalogEntry[]> {
  const userId = principalUserId(principal)
  const organizationId =
    'organizationId' in context ? context.organizationId : context.workspaceOrganizationId
  const [allowedIntegrations, blockVisibility] = await Promise.all([
    'organizationId' in context
      ? allowedOrganizationIntegrationTypes(context.organizationId)
      : allowedIntegrationTypes(principal, context.workspaceId),
    getBlockVisibility({
      ...(userId ? { userId } : {}),
      ...(organizationId ? { orgId: organizationId } : {}),
    }),
  ])
  const services = getAllOAuthServices()
  const oauthServices = services.filter((service) => service.authType === 'oauth')
  const visibility = createIntegrationCredentialVisibility({
    allowedIntegrationTypes: allowedIntegrations,
    blockVisibility,
    oauthServices: services,
  })

  const oauthEntries: OAuthCredentialProviderCatalogEntry[] = oauthServices.map((service) => {
    const config = getServiceConfigByServiceId(service.serviceId)
    if (!config) {
      throw new Error(`OAuth service ${service.serviceId} is missing its canonical configuration`)
    }
    const providerIds = [service.providerId, ...(service.additionalProviderIds ?? [])]
    if (providerIds.length > 1 && !config.providerIdLabels) {
      throw new Error(`OAuth service ${service.serviceId} is missing provider option labels`)
    }
    const authorizationOptions = providerIds.map((providerId) => {
      const label = providerIds.length === 1 ? service.name : config.providerIdLabels?.[providerId]
      if (!label) {
        throw new Error(`OAuth provider ${providerId} is missing its authorization option label`)
      }
      return { providerId, label }
    })

    return {
      type: 'oauth',
      serviceId: service.serviceId,
      name: service.name,
      description: service.description,
      providerFamily: service.baseProvider,
      available:
        oauthType === 'managed_oauth'
          ? visibility.isCredentialVisible({ providerId: service.providerId, type: oauthType })
          : visibility.isOAuthServiceVisible(service),
      supportsReconnect: true,
      authorizationOptions,
      fields: (service.clientConfiguration?.fields ?? []).map((field) => ({
        id: field.id,
        label: field.label,
        placeholder: field.placeholder,
        required: true,
        secret: field.secret,
        multiline: false,
        ...(field.options ? { options: [...field.options] } : {}),
        ...(field.hint ? { hint: field.hint } : {}),
      })),
    }
  })

  const serviceAccountOwners = new Map<string, OAuthServiceMetadata>()
  for (const service of services) {
    const serviceAccountProviderId =
      service.serviceAccountProviderId ??
      (service.authType === 'service_account' ? service.providerId : undefined)
    if (serviceAccountProviderId && !serviceAccountOwners.has(serviceAccountProviderId)) {
      serviceAccountOwners.set(serviceAccountProviderId, service)
    }
  }

  const serviceAccountEntries: ServiceAccountCredentialProviderCatalogEntry[] = [
    ...serviceAccountOwners,
  ].map(([providerId, owner]) => {
    const descriptor = getServiceAccountDescriptor(providerId)
    return {
      type: 'service_account',
      serviceId: providerId,
      providerId,
      name: descriptor.name,
      description: descriptor.description,
      providerFamily: owner.baseProvider,
      available: visibility.isCredentialVisible({ providerId, type: 'service_account' }),
      docsUrl: descriptor.docsUrl,
      ...(descriptor.helpText ? { helpText: descriptor.helpText } : {}),
      requiresClientGeneratedCredentialId: descriptor.requiresClientGeneratedCredentialId === true,
      fields: descriptor.fields,
    }
  })

  return [...oauthEntries, ...serviceAccountEntries]
}

export function requireAvailableOAuthCredentialProvider(
  catalog: readonly CredentialProviderCatalogEntry[],
  providerId: string
): OAuthCredentialProviderCatalogEntry {
  const provider = catalog.find(
    (entry): entry is OAuthCredentialProviderCatalogEntry =>
      entry.type === 'oauth' &&
      entry.authorizationOptions.some((option) => option.providerId === providerId)
  )
  if (!provider) {
    throw new OrchestrationError('validation', `Unknown OAuth provider: ${providerId}`)
  }
  if (!provider.available) {
    throw new OrchestrationError('conflict', `OAuth provider is unavailable: ${providerId}`)
  }
  return provider
}

export function requireAvailableServiceAccountCredentialProvider(
  catalog: readonly CredentialProviderCatalogEntry[],
  providerId: string
): ServiceAccountCredentialProviderCatalogEntry {
  const provider = catalog.find(
    (entry): entry is ServiceAccountCredentialProviderCatalogEntry =>
      entry.type === 'service_account' && entry.providerId === providerId
  )
  if (!provider) {
    throw new OrchestrationError('validation', `Unknown service-account provider: ${providerId}`)
  }
  if (!provider.available) {
    throw new OrchestrationError(
      'conflict',
      `Service-account provider is unavailable: ${providerId}`
    )
  }
  return provider
}
