import {
  getManagedMcpConnector,
  isManagedMcpConnectorId,
} from '../apps/sim/lib/credential-groups/managed-mcp-connectors'
import {
  type ClientCredentialAccountField,
  getClientCredentialAccountDescriptor,
} from '../apps/sim/lib/credentials/client-credential-accounts/descriptors'
import { getServiceAccountConnectNoun } from '../apps/sim/lib/credentials/service-account-provider-ids'
import {
  getTokenServiceAccountDescriptor,
  type TokenServiceAccountField,
} from '../apps/sim/lib/credentials/token-service-accounts/descriptors'
import {
  ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID,
  GOOGLE_SERVICE_ACCOUNT_PROVIDER_ID,
  OCI_API_KEY_SERVICE_ACCOUNT_PROVIDER_ID,
  ORACLE_DATABASE_SERVICE_ACCOUNT_PROVIDER_ID,
  SLACK_CUSTOM_BOT_PROVIDER_ID,
} from '../apps/sim/lib/oauth/types'
import {
  getAllOAuthServices,
  getScopeDescription,
  getServiceConfigByServiceId,
} from '../apps/sim/lib/oauth/utils'
import type {
  CredentialConnection,
  CredentialField,
} from '../apps/sim/platform/lib/integrations/credential-model'

interface CatalogSource {
  type: string
  authType: 'oauth' | 'api-key' | 'none'
  oauthServiceId?: string
}

const services = new Map(getAllOAuthServices().map((service) => [service.serviceId, service]))

function descriptorField(
  field: TokenServiceAccountField | ClientCredentialAccountField,
  defaultAuthMethod?: string
): CredentialField {
  return {
    id: field.id,
    label: field.label,
    placeholder: field.placeholder,
    secret: field.secret,
    ...('multiline' in field && field.multiline ? { multiline: true } : {}),
    ...('optional' in field && field.optional && !field.requiredForAuthMethods
      ? { optional: true }
      : {}),
    ...('options' in field && field.options ? { options: field.options } : {}),
    ...('requiredForAuthMethods' in field && field.requiredForAuthMethods
      ? { visibleWhen: { field: 'authMethod', values: field.requiredForAuthMethods } }
      : {}),
    ...(field.id === 'authMethod' && defaultAuthMethod ? { defaultValue: defaultAuthMethod } : {}),
    ...('hint' in field && field.hint
      ? { hint: field.hint }
      : field.hintMessage
        ? { hint: field.hintMessage }
        : {}),
  }
}

/** Bespoke requirements mirror the existing workspace connection forms. */
function bespokeSetup(providerId: string): Pick<CredentialConnection, 'setup' | 'fields'> | null {
  switch (providerId) {
    case GOOGLE_SERVICE_ACCOUNT_PROVIDER_ID:
      return {
        setup: 'google-json',
        fields: [
          {
            id: 'serviceAccountJson',
            label: 'JSON key',
            placeholder: 'Paste the service-account JSON key',
            secret: true,
            multiline: true,
          },
        ],
      }
    case ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID:
      return {
        setup: 'fields',
        fields: [
          { id: 'apiToken', label: 'API token', placeholder: 'Paste the API token', secret: true },
          { id: 'domain', label: 'Site domain', placeholder: 'your-team.atlassian.net' },
        ],
      }
    case SLACK_CUSTOM_BOT_PROVIDER_ID:
      return {
        setup: 'slack-bot',
        fields: [
          { id: 'botToken', label: 'Bot token', placeholder: 'xoxb-...', secret: true },
          {
            id: 'signingSecret',
            label: 'Signing secret',
            placeholder: 'Paste the signing secret',
            secret: true,
          },
        ],
      }
    case OCI_API_KEY_SERVICE_ACCOUNT_PROVIDER_ID:
      return {
        setup: 'fields',
        fields: [
          { id: 'tenancyOcid', label: 'Tenancy OCID', placeholder: 'ocid1.tenancy.oc1..' },
          { id: 'userOcid', label: 'User OCID', placeholder: 'ocid1.user.oc1..' },
          {
            id: 'fingerprint',
            label: 'Fingerprint',
            placeholder: '00:11:22:33:44:55:66:77:88:99:aa:bb:cc:dd:ee:ff',
          },
          {
            id: 'privateKey',
            label: 'Private key',
            placeholder: '-----BEGIN PRIVATE KEY-----',
            secret: true,
            multiline: true,
          },
          {
            id: 'privateKeyPassphrase',
            label: 'Private-key passphrase',
            secret: true,
            optional: true,
          },
          { id: 'region', label: 'Region', placeholder: 'us-ashburn-1' },
        ],
      }
    case ORACLE_DATABASE_SERVICE_ACCOUNT_PROVIDER_ID:
      return {
        setup: 'oracle-database',
        fields: [
          { id: 'host', label: 'Host', placeholder: 'db.example.com' },
          { id: 'port', label: 'Port', placeholder: '1521', defaultValue: '1521' },
          {
            id: 'protocol',
            label: 'Protocol',
            defaultValue: 'tcps',
            options: [
              { value: 'tcps', label: 'TCPS (TLS)' },
              { value: 'tcp', label: 'TCP' },
            ],
          },
          {
            id: 'connectionType',
            label: 'Connection identifier',
            defaultValue: 'serviceName',
            options: [
              { value: 'serviceName', label: 'Service name' },
              { value: 'sid', label: 'SID' },
            ],
          },
          {
            id: 'serviceName',
            label: 'Service name',
            placeholder: 'FREEPDB1',
            visibleWhen: { field: 'connectionType', values: ['serviceName'] },
          },
          {
            id: 'sid',
            label: 'SID',
            placeholder: 'ORCL',
            visibleWhen: { field: 'connectionType', values: ['sid'] },
          },
          { id: 'username', label: 'Username', placeholder: 'app_user' },
          {
            id: 'password',
            label: 'Password',
            placeholder: 'Enter the database password',
            secret: true,
          },
          {
            id: 'walletContent',
            label: 'PEM wallet',
            placeholder: 'Paste ewallet.pem content',
            secret: true,
            multiline: true,
            optional: true,
            visibleWhen: { field: 'protocol', values: ['tcps'] },
          },
          {
            id: 'walletPassword',
            label: 'Wallet password',
            placeholder: 'Password for an encrypted PEM wallet',
            secret: true,
            optional: true,
            visibleWhen: { field: 'protocol', values: ['tcps'] },
          },
        ],
      }
    default:
      return null
  }
}

function serviceAccountConnection(providerId: string): CredentialConnection | null {
  const token = getTokenServiceAccountDescriptor(providerId)
  const client = getClientCredentialAccountDescriptor(providerId)
  const descriptor = token ?? client
  const setup = descriptor
    ? {
        setup: 'fields' as const,
        fields: descriptor.fields.map((field) => descriptorField(field, client?.defaultAuthMethod)),
      }
    : bespokeSetup(providerId)
  if (!setup) return null
  return {
    id: providerId,
    kind: 'service_account',
    providerId,
    label:
      providerId === SLACK_CUSTOM_BOT_PROVIDER_ID
        ? 'Set up a custom bot'
        : `Add ${getServiceAccountConnectNoun(providerId)}`,
    ...setup,
  }
}

/** Project only declared enrollment methods; a catalog API-key label creates no form by itself. */
export function integrationConnections(integration: CatalogSource): CredentialConnection[] {
  const type = integration.type.replace(/_v\d+$/, '')
  if (type === 'gitlab')
    return [
      {
        id: 'gitlab-personal-token',
        kind: 'personal_token',
        label: 'Add personal token',
        providerId: 'gitlab',
        setup: 'fields',
        personalOnly: true,
        fields: [
          {
            id: 'domain',
            label: 'GitLab host',
            placeholder: 'gitlab.example.com',
            defaultValue: 'gitlab.com',
          },
          {
            id: 'apiToken',
            label: 'Personal access token',
            placeholder: 'glpat-…',
            secret: true,
            hint: 'Only you can use this connection.',
          },
        ],
      },
    ]
  const service = services.get(integration.oauthServiceId ?? type)
  if (!service) {
    if (!isManagedMcpConnectorId(type)) return []
    const connector = getManagedMcpConnector(type)
    if (!('url' in connector)) return []
    return [
      {
        id: `${connector.id}-mcp`,
        kind: 'mcp',
        providerId: connector.id,
        label: 'Connect your account',
        setup: 'mcp-oauth',
        personalOnly: true,
        fields: [],
      },
    ]
  }
  const config = getServiceConfigByServiceId(service.serviceId)
  const methods: CredentialConnection[] = []
  if (integration.authType === 'oauth' && service.authType === 'oauth' && config) {
    const providers = [service.providerId, ...(service.additionalProviderIds ?? [])]
    for (const providerId of providers) {
      const label =
        providers.length > 1 ? config.providerIdLabels?.[providerId] : 'Connect with OAuth'
      if (!label) throw new Error(`Missing OAuth option label for ${providerId}`)
      methods.push({
        id: providerId,
        kind: 'oauth',
        label,
        providerId,
        setup: 'oauth',
        requiredScopes: (config.scopes ?? []).map((id) => ({
          id,
          label: getScopeDescription(id, providerId),
        })),
        fields: [
          ...(service.clientConfiguration?.fields ?? []).map((field) => ({ ...field })),
          ...(providerId === 'microsoft-dataverse'
            ? [
                {
                  id: 'dataverseEnvironmentUrl',
                  label: 'Environment URL',
                  placeholder: 'https://your-org.crm.dynamics.com',
                },
              ]
            : []),
        ],
      })
    }
  }
  const serviceAccountProviderId =
    service.serviceAccountProviderId ??
    (service.authType === 'service_account' ? service.providerId : undefined)
  if (serviceAccountProviderId) {
    const connection = serviceAccountConnection(serviceAccountProviderId)
    if (connection) methods.push(connection)
  }
  return methods
}
