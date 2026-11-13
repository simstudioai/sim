import type { Principal } from '@sim/auth/principal'
import { getBlockVisibility } from '@/lib/core/config/block-visibility'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  CLIENT_CREDENTIAL_ACCOUNT_DESCRIPTORS,
  type ClientCredentialAccountField,
} from '@/lib/credentials/client-credential-accounts/descriptors'
import { getDatabaseConnectionDescriptor } from '@/lib/credentials/database-connections/descriptors'
import {
  SNOWFLAKE_SERVICE_ACCOUNT_PROVIDER_ID,
  TOKEN_SERVICE_ACCOUNT_DESCRIPTORS,
  type TokenServiceAccountField,
} from '@/lib/credentials/token-service-accounts/descriptors'
import {
  isWorkloadIdentityServiceAccountProviderId,
  WORKLOAD_IDENTITY_KEYLESS_CONFIGS,
  workloadIdentityProviderFor,
} from '@/lib/credentials/workload-identity/audiences'
import { isWorkloadIdentityConfigured } from '@/lib/credentials/workload-identity/issuer'
import { createIntegrationCredentialVisibility } from '@/lib/integrations/credential-visibility.server'
import {
  allowedIntegrationTypes,
  allowedOrganizationIntegrationTypes,
  principalUserId,
} from '@/lib/integrations/principal-scope.server'
import { GITHUB_INSTALLATION_PROVIDER_ID } from '@/lib/oauth/github-installation-types'
import {
  ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID,
  AWS_SERVICE_ACCOUNT_PROVIDER_ID,
  DATABRICKS_SERVICE_ACCOUNT_PROVIDER_ID,
  GOOGLE_SERVICE_ACCOUNT_PROVIDER_ID,
  MICROSOFT_APP_SERVICE_ACCOUNT_PROVIDER_ID,
  type OAuthServiceMetadata,
  OCI_API_KEY_SERVICE_ACCOUNT_PROVIDER_ID,
  ORACLE_DATABASE_SERVICE_ACCOUNT_PROVIDER_ID,
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
  /** The value an optional field takes when it is omitted (a region's default). */
  defaultValue?: string
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
  /** The provider's keyless mode; absent without one, or when this deployment cannot sign. */
  keyless?: CredentialProviderKeylessMode
}

interface CredentialProviderKeylessMode {
  authType: string
  requiredConfigFields: string[]
  optionalConfigFields: string[]
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
    required:
      !('optional' in field && field.optional) &&
      !('defaultValue' in field && field.defaultValue !== undefined),
    secret: field.secret,
    multiline: 'multiline' in field && field.multiline === true,
    ...('requiredForAuthMethods' in field && field.requiredForAuthMethods
      ? { requiredForAuthMethods: [...field.requiredForAuthMethods] }
      : {}),
    ...('options' in field && field.options ? { options: [...field.options] } : {}),
    ...('defaultValue' in field && field.defaultValue !== undefined
      ? { defaultValue: field.defaultValue }
      : {}),
    ...('hint' in field && field.hint
      ? { hint: field.hint }
      : 'hintMessage' in field && field.hintMessage
        ? { hint: field.hintMessage }
        : {}),
  }
}

interface KeylessCatalogMode {
  keyless: CredentialProviderKeylessMode
  /** Where keyless works, when narrower than the provider. */
  scope?: string
}

function keylessModeFor(providerId: string): KeylessCatalogMode | undefined {
  if (!isWorkloadIdentityServiceAccountProviderId(providerId)) return undefined
  const { authType, requiredFields, optionalFields, scope } =
    WORKLOAD_IDENTITY_KEYLESS_CONFIGS[workloadIdentityProviderFor(providerId)]
  return {
    keyless: {
      authType,
      requiredConfigFields: [...requiredFields],
      optionalConfigFields: [...optionalFields],
    },
    ...(scope ? { scope } : {}),
  }
}

/**
 * Adds a provider's keyless mode to its key-based descriptor, the same way for
 * every keyless provider: one description suffix, and a hint on the
 * `serviceAccountJson` field, which is added as an optional alternative to the
 * other fields when the descriptor has none.
 */
function withKeylessMode(
  descriptor: ServiceAccountDescriptor,
  mode: KeylessCatalogMode | undefined
): ServiceAccountDescriptor & { keyless?: CredentialProviderKeylessMode } {
  if (!mode) return descriptor
  const { keyless, scope } = mode
  const scopeNote = scope ? ` ${scope}` : ''
  const hint = `Keyless: send the keylessConfig from Create workload identity subject with ${keyless.requiredConfigFields.join(', ')} added. Optionally add audience to have Sim sign for your own value instead of the default audience (for Google Cloud, the workload identity provider's resource name), and trust that value.${scopeNote}`
  const configurationField = descriptor.fields.find((field) => field.id === 'serviceAccountJson')
  const fields = configurationField
    ? descriptor.fields.map((field) =>
        field === configurationField
          ? { ...field, hint: field.hint ? `${field.hint} ${hint}` : hint }
          : field
      )
    : [
        ...descriptor.fields,
        {
          id: 'serviceAccountJson',
          label: 'Keyless configuration',
          placeholder: JSON.stringify({
            authType: keyless.authType,
            ...Object.fromEntries(keyless.requiredConfigFields.map((field) => [field, '...'])),
            subject: '...',
            subjectProof: '...',
          }),
          required: false,
          secret: true,
          multiline: true,
          hint: `Send instead of the other fields. ${hint}`,
        },
      ]
  return {
    ...descriptor,
    description: `${descriptor.description} Also supports a keyless credential that trusts Sim through workload identity federation.${scopeNote}`,
    fields,
    keyless,
  }
}

function getServiceAccountDescriptor(providerId: string): ServiceAccountDescriptor {
  if (providerId === GITHUB_INSTALLATION_PROVIDER_ID) {
    return {
      name: 'GitHub App installation',
      description: 'Index repository content with a GitHub App installation.',
      docsUrl: 'https://docs.sim.ai/search/github',
      helpText:
        'Connect an installation through your organization’s Search integrations. Each person connects their own GitHub account to establish access.',
      fields: [],
    }
  }
  if (providerId === DATABRICKS_SERVICE_ACCOUNT_PROVIDER_ID) {
    return {
      name: 'Databricks connection',
      description:
        'Use the Databricks block with a personal access token or a service principal OAuth secret.',
      docsUrl: 'https://docs.sim.ai/integrations/databricks-credentials',
      fields: [
        {
          id: 'serviceAccountJson',
          label: 'Connection configuration',
          placeholder:
            '{"authType":"personal_access_token","host":"dbc-abc123.cloud.databricks.com","token":"dapi..."}',
          required: true,
          secret: true,
          multiline: true,
          hint: `JSON object with host and authType: "personal_access_token" (token) or "service_principal" (clientId, clientSecret).`,
        },
      ],
    }
  }
  if (providerId === MICROSOFT_APP_SERVICE_ACCOUNT_PROVIDER_ID) {
    return {
      name: 'Microsoft app credential',
      description:
        'Use Microsoft Entra ID, SharePoint, Intune, Dataverse, and Dynamics 365 as an app registration (app-only), with a client secret or a certificate.',
      docsUrl: 'https://docs.sim.ai/integrations/microsoft-app-credentials',
      fields: [
        {
          id: 'serviceAccountJson',
          label: 'Credential configuration',
          placeholder:
            '{"authType":"client_secret","tenantId":"...","clientId":"...","clientSecret":"..."}',
          required: true,
          secret: true,
          multiline: true,
          hint: `JSON object with tenantId, clientId, optional environmentUrl (Dataverse and Dynamics 365), and authType: "client_secret" (clientSecret) or "certificate" (privateKey, certificate as PEM).`,
        },
      ],
    }
  }
  if (providerId === AWS_SERVICE_ACCOUNT_PROVIDER_ID) {
    return {
      name: 'AWS credential',
      description: 'Use AWS blocks with saved access keys, or access keys that assume an IAM role.',
      docsUrl: 'https://docs.sim.ai/integrations/aws-credentials',
      fields: [
        {
          id: 'serviceAccountJson',
          label: 'Credential configuration',
          placeholder: '{"authType":"access_keys","accessKeyId":"AKIA...","secretAccessKey":"..."}',
          required: true,
          secret: true,
          multiline: true,
          hint: `JSON object with authType: "access_keys" (accessKeyId, secretAccessKey, optional stsRegion) or "assume_role" (accessKeyId, secretAccessKey, roleArn, optional externalId and stsRegion).`,
        },
      ],
    }
  }
  const database = getDatabaseConnectionDescriptor(providerId)
  if (database) {
    const tls = database.tls
      .map(
        (field) =>
          `${field.id} (${field.options.map((option) => option.value).join(', ')}; default ${field.defaultValue})`
      )
      .join(' and ')
    const tlsTradeoffs = database.tls.map((field) => `${field.id}: ${field.hint}`).join(' ')
    return {
      name: `${database.label} connection`,
      description: `Connect to ${database.label} with a saved host, database, login, and transport-security settings.`,
      docsUrl: database.docsUrl,
      fields: [
        {
          id: 'serviceAccountJson',
          label: 'Connection configuration',
          placeholder: JSON.stringify({
            host: 'db.example.com',
            port: database.defaultPort,
            database: 'app',
            username: database.usernamePlaceholder,
            password: '...',
            ...Object.fromEntries(database.tls.map((field) => [field.id, field.defaultValue])),
          }),
          required: true,
          secret: true,
          multiline: true,
          hint: `JSON object with host, port, database, username, password, and optional ${tls}. Sim verifies it with SELECT 1 before saving. ${tlsTradeoffs}`,
        },
      ],
    }
  }
  if (providerId === ORACLE_DATABASE_SERVICE_ACCOUNT_PROVIDER_ID) {
    return {
      name: 'Oracle Database connection',
      description:
        'Connect to Oracle Database with a saved username, password, and optional TCPS wallet.',
      docsUrl: 'https://docs.sim.ai/integrations/oracledb',
      fields: [
        {
          id: 'serviceAccountJson',
          label: 'Connection configuration',
          placeholder:
            '{"host":"db.example.com","protocol":"tcps","serviceName":"APP","username":"app_user","password":"..."}',
          required: true,
          secret: true,
          multiline: true,
          hint: 'JSON object with host, port, protocol (tcp or tcps), connectionType (serviceName or sid), the selected identifier, username, password, and optional walletContent and walletPassword.',
        },
      ],
    }
  }
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
      /**
       * The Request URL embeds the credential id, so the first-party modal
       * pre-generates one to show the URL before saving. That is a convenience,
       * not a requirement: creation mints an id when none is supplied, and an
       * API caller configures Slack from the id the create response returns.
       */
      requiresClientGeneratedCredentialId: false,
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
  if (providerId === OCI_API_KEY_SERVICE_ACCOUNT_PROVIDER_ID) {
    return {
      name: 'OCI API key',
      description: 'Connect Oracle Cloud Infrastructure with an API signing key.',
      docsUrl: 'https://docs.oracle.com/en-us/iaas/Content/API/Concepts/apisigningkey.htm',
      fields: [
        {
          id: 'tenancyOcid',
          label: 'Tenancy OCID',
          placeholder: 'ocid1.tenancy.oc1..',
          required: true,
          secret: false,
          multiline: false,
        },
        {
          id: 'userOcid',
          label: 'User OCID',
          placeholder: 'ocid1.user.oc1..',
          required: true,
          secret: false,
          multiline: false,
        },
        {
          id: 'fingerprint',
          label: 'Fingerprint',
          placeholder: '00:11:22:33:44:55:66:77:88:99:aa:bb:cc:dd:ee:ff',
          required: true,
          secret: false,
          multiline: false,
        },
        {
          id: 'privateKey',
          label: 'Private key',
          placeholder: '-----BEGIN PRIVATE KEY-----',
          required: true,
          secret: true,
          multiline: true,
        },
        {
          id: 'privateKeyPassphrase',
          label: 'Private-key passphrase',
          placeholder: 'Optional',
          required: false,
          secret: true,
          multiline: false,
        },
        {
          id: 'region',
          label: 'Region',
          placeholder: 'us-ashburn-1',
          required: true,
          secret: false,
          multiline: false,
        },
      ],
    }
  }

  if (providerId === SNOWFLAKE_SERVICE_ACCOUNT_PROVIDER_ID) {
    const tokenDescriptor = TOKEN_SERVICE_ACCOUNT_DESCRIPTORS[SNOWFLAKE_SERVICE_ACCOUNT_PROVIDER_ID]
    return {
      name: 'Snowflake connection',
      description: 'Connect Snowflake with a programmatic access token or an RSA key pair.',
      docsUrl: tokenDescriptor.docsUrl,
      helpText: tokenDescriptor.helpText,
      fields: [
        ...tokenDescriptor.fields.map(providerField),
        {
          id: 'serviceAccountJson',
          label: 'Connection configuration',
          placeholder:
            '{"authType":"key_pair","host":"myorg-myaccount.snowflakecomputing.com","user":"SIM_SERVICE","privateKey":"-----BEGIN PRIVATE KEY-----..."}',
          required: false,
          secret: true,
          multiline: true,
          hint: 'Send instead of the other fields. Key pair: JSON object with authType: "key_pair", host, user, and privateKey (an unencrypted RSA private key as PEM, 2048 to 4096 bits, whose public key is set on the user).',
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
  const [allowedIntegrations, blockVisibility, keylessAvailable] = await Promise.all([
    'organizationId' in context
      ? allowedOrganizationIntegrationTypes(context.organizationId)
      : allowedIntegrationTypes(principal, context.workspaceId),
    getBlockVisibility({
      ...(userId ? { userId } : {}),
      ...(organizationId ? { orgId: organizationId } : {}),
    }),
    // Keyless subjects are issued for workspaces only, and only where Sim can sign.
    'organizationId' in context ? false : isWorkloadIdentityConfigured(),
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
    const descriptor = withKeylessMode(
      getServiceAccountDescriptor(providerId),
      keylessAvailable ? keylessModeFor(providerId) : undefined
    )
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
      ...(descriptor.keyless ? { keyless: descriptor.keyless } : {}),
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
