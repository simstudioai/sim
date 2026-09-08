import { db } from '@sim/db'
import { credentialGroup } from '@sim/db/schema'
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
  slack?: SlackCredentialGroupConfiguration
}

function isSlackConfiguration(value: unknown): value is SlackCredentialGroupConfiguration {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return (
    (candidate.slackBotCredentialId === undefined ||
      typeof candidate.slackBotCredentialId === 'string') &&
    typeof candidate.clientId === 'string' &&
    typeof candidate.clientSecret === 'string' &&
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
    ...(candidate.slack ? { slack: candidate.slack as SlackCredentialGroupConfiguration } : {}),
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
  return configuration.slack ?? null
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
      return configuration.slack
    })
  )
}
