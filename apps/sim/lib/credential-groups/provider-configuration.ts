import { db } from '@sim/db'
import { credentialGroup, slackApp } from '@sim/db/schema'
import { getErrorMessage } from '@sim/utils/errors'
import { and, eq, sql } from 'drizzle-orm'
import { resourceScopeFromOwner } from '@/lib/core/resource-scope'
import { resourceScopeCondition } from '@/lib/core/resource-scope.server'
import { decryptSecret, encryptSecret } from '@/lib/core/security/encryption'
import type { DbOrTx } from '@/lib/db/types'

const CREDENTIAL_GROUP_PROVIDER_CONFIGURATION_TYPE =
  'credential-group-provider-configuration' as const
const CREDENTIAL_GROUP_PROVIDER_CONFIGURATION_VERSION = 1 as const

export interface SlackCredentialGroupConfiguration {
  slackBotCredentialId?: string
  clientId: string
  clientSecret: string
  appId: string
  teamId: string
  scopes: string[]
  verifiedAt: string
}

export interface CredentialGroupProviderConfiguration {
  type: typeof CREDENTIAL_GROUP_PROVIDER_CONFIGURATION_TYPE
  version: typeof CREDENTIAL_GROUP_PROVIDER_CONFIGURATION_VERSION
  slack?: StoredSlackConfiguration
}

/** Member grants reference the same app identity and secrets used by the Search bot. */
export interface SlackAppCredentialGroupConfiguration {
  source: 'slack_app'
  appId: string
  teamId: string
  scopes: string[]
  verifiedAt: string
  slackBotCredentialId?: never
}
type StoredSlackConfiguration =
  | SlackCredentialGroupConfiguration
  | SlackAppCredentialGroupConfiguration

function isSlackConfiguration(value: unknown): value is StoredSlackConfiguration {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return (
    (candidate.slackBotCredentialId === undefined ||
      typeof candidate.slackBotCredentialId === 'string') &&
    (candidate.source === 'slack_app'
      ? candidate.clientId === undefined &&
        candidate.clientSecret === undefined &&
        candidate.slackBotCredentialId === undefined
      : candidate.source === undefined &&
        typeof candidate.clientId === 'string' &&
        typeof candidate.clientSecret === 'string') &&
    typeof candidate.appId === 'string' &&
    typeof candidate.teamId === 'string' &&
    Array.isArray(candidate.scopes) &&
    candidate.scopes.every((scope) => typeof scope === 'string') &&
    typeof candidate.verifiedAt === 'string'
  )
}

function parseCredentialGroupProviderConfiguration(
  value: unknown
): CredentialGroupProviderConfiguration {
  if (!value || typeof value !== 'object') {
    throw new Error('Credential Group provider configuration is malformed')
  }
  const candidate = value as Record<string, unknown>
  if (
    candidate.type !== CREDENTIAL_GROUP_PROVIDER_CONFIGURATION_TYPE ||
    candidate.version !== CREDENTIAL_GROUP_PROVIDER_CONFIGURATION_VERSION ||
    (candidate.slack !== undefined && !isSlackConfiguration(candidate.slack))
  ) {
    throw new Error('Credential Group provider configuration is malformed')
  }
  return {
    type: CREDENTIAL_GROUP_PROVIDER_CONFIGURATION_TYPE,
    version: CREDENTIAL_GROUP_PROVIDER_CONFIGURATION_VERSION,
    ...(candidate.slack ? { slack: candidate.slack as StoredSlackConfiguration } : {}),
  }
}

export function emptyCredentialGroupProviderConfiguration(): CredentialGroupProviderConfiguration {
  return {
    type: CREDENTIAL_GROUP_PROVIDER_CONFIGURATION_TYPE,
    version: CREDENTIAL_GROUP_PROVIDER_CONFIGURATION_VERSION,
  }
}

export async function encryptCredentialGroupProviderConfiguration(
  configuration: CredentialGroupProviderConfiguration
): Promise<string> {
  const parsed = parseCredentialGroupProviderConfiguration(configuration)
  return (await encryptSecret(JSON.stringify(parsed))).encrypted
}

export async function decryptCredentialGroupProviderConfiguration(
  encryptedConfiguration: string | null
): Promise<CredentialGroupProviderConfiguration> {
  if (!encryptedConfiguration) return emptyCredentialGroupProviderConfiguration()
  try {
    const decrypted = await decryptSecret(encryptedConfiguration)
    return parseCredentialGroupProviderConfiguration(JSON.parse(decrypted.decrypted) as unknown)
  } catch (error) {
    throw new Error(
      `Credential Group provider configuration could not be read: ${getErrorMessage(error)}`
    )
  }
}

export async function getSlackCredentialGroupConfiguration(params: {
  workspaceId?: string | null
  organizationId?: string | null
  credentialGroupId: string
  executor?: DbOrTx
}): Promise<SlackCredentialGroupConfiguration | null> {
  const executor = params.executor ?? db
  const [row] = await executor
    .select({ encryptedProviderConfiguration: credentialGroup.encryptedProviderConfiguration })
    .from(credentialGroup)
    .where(
      and(
        eq(credentialGroup.id, params.credentialGroupId),
        resourceScopeCondition(credentialGroup, resourceScopeFromOwner(params))
      )
    )
    .limit(1)
  if (!row) return null
  const configuration = await decryptCredentialGroupProviderConfiguration(
    row.encryptedProviderConfiguration
  )
  return configuration.slack ? resolveSlackConfiguration(configuration.slack, params) : null
}

async function resolveSlackConfiguration(
  configuration: StoredSlackConfiguration,
  params: { organizationId?: string | null; executor?: DbOrTx }
): Promise<SlackCredentialGroupConfiguration> {
  /** Legacy configurations remain readable until their admin adopts the shared app setup. */
  if (!('source' in configuration)) return configuration
  if (!params.organizationId)
    throw new Error('Shared Slack app configuration requires an organization')
  const [app] = await (params.executor ?? db)
    .select()
    .from(slackApp)
    .where(
      and(
        eq(slackApp.id, configuration.appId),
        eq(slackApp.organizationId, params.organizationId),
        eq(slackApp.kind, 'custom')
      )
    )
    .limit(1)
  if (!app) throw new Error('Organization Slack app configuration is missing')
  const { decrypted: clientSecret } = await decryptSecret(app.encryptedClientSecret)
  return {
    appId: app.id,
    teamId: configuration.teamId,
    clientId: app.clientId,
    clientSecret,
    scopes: configuration.scopes,
    verifiedAt: configuration.verifiedAt,
  }
}

export async function listSlackCredentialGroupConfigurationsForBot(params: {
  workspaceId?: string | null
  organizationId?: string | null
  slackBotCredentialId?: string
}): Promise<SlackCredentialGroupConfiguration[]> {
  const rows = await db
    .select({ encryptedProviderConfiguration: credentialGroup.encryptedProviderConfiguration })
    .from(credentialGroup)
    .where(
      and(
        resourceScopeCondition(credentialGroup, resourceScopeFromOwner(params)),
        sql`${credentialGroup.options} @> ${JSON.stringify([
          { provider: 'slack', slackBotCredentialId: params.slackBotCredentialId },
        ])}::jsonb`
      )
    )
  return Promise.all(
    rows.map(async (row) => {
      const configuration = await decryptCredentialGroupProviderConfiguration(
        row.encryptedProviderConfiguration
      )
      if (!configuration.slack) {
        throw new Error('Credential Group Slack configuration is missing')
      }
      if (configuration.slack.slackBotCredentialId !== params.slackBotCredentialId) {
        throw new Error('Credential Group Slack configuration does not match its custom bot')
      }
      return resolveSlackConfiguration(configuration.slack, params)
    })
  )
}
