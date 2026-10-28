import { db } from '@sim/db'
import { credentialGroup } from '@sim/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  decryptCredentialGroupProviderConfiguration,
  encryptCredentialGroupProviderConfiguration,
  type SlackCredentialGroupConfiguration,
} from '@/lib/credential-groups/provider-configuration'
import { acquireAdvisoryXactLock } from '@/lib/db/advisory-locks'
import type { DbOrTx, DbTransaction } from '@/lib/db/types'

/**
 * Serializes an organization's Slack member setup with Slack Search's installation writes, so a
 * bot can never be added or rebound under a member setup that already checked the installations.
 * Install, rebind, enable, disable and admin removal all take it, first, before any Slack app or
 * workspace lock. Slack revocations, which must never wait on setup, and the cascade from
 * deleting a bot credential skip it: they only withdraw a bot, which member setup tolerates.
 */
export async function lockOrganizationSlackApp(tx: DbTransaction, organizationId: string) {
  await acquireAdvisoryXactLock(tx, 'slack_org_app', `slack-org-app:${organizationId}`)
}

/** Called with canonical, authorized organization scope by the app setup use case. */
export async function loadOrganizationSlackMemberApps(
  organizationId: string,
  executor: DbOrTx = db
) {
  const rows = await executor
    .select({
      id: credentialGroup.id,
      encryptedConfiguration: credentialGroup.encryptedProviderConfiguration,
    })
    .from(credentialGroup)
    .where(
      and(
        eq(credentialGroup.organizationId, organizationId),
        sql`${credentialGroup.options} @> '[{"provider":"slack"}]'::jsonb`
      )
    )
    .limit(101)
  if (rows.length > 100)
    throw new OrchestrationError('validation', 'Too many organization Slack account configurations')
  const configurations = await Promise.all(
    rows.map(async (row) => ({
      ...row,
      configuration: await decryptCredentialGroupProviderConfiguration(row.encryptedConfiguration),
    }))
  )
  return configurations.filter((row) => row.configuration.slack !== undefined)
}

/**
 * Resolves the one Slack app and workspace the organization's members connect through, with the
 * union of their scopes. Fails when member configurations reference more than one app.
 */
export async function resolveOrganizationSlackMemberApp(
  organizationId: string,
  executor: DbOrTx = db
) {
  const rows = await loadOrganizationSlackMemberApps(organizationId, executor)
  const configurations = rows.flatMap((row) =>
    row.configuration.slack ? [row.configuration.slack] : []
  )
  const first = configurations[0]
  if (
    first &&
    configurations.some(
      (configuration) =>
        configuration.appId !== first.appId || configuration.teamId !== first.teamId
    )
  )
    throw new OrchestrationError(
      'conflict',
      'Organization Slack member accounts reference multiple apps. Consolidate them before configuring Search.'
    )
  return {
    app: first ? { appId: first.appId, teamId: first.teamId } : null,
    scopes: [...new Set(configurations.flatMap((configuration) => configuration.scopes))],
  }
}

type SlackAppIdentity = Pick<SlackCredentialGroupConfiguration, 'appId' | 'teamId'>

/**
 * Refuses a Search bot outside the members' Slack workspace, or on a different app unless the
 * bot runs on the shared Sim Search app.
 */
export function requireSearchBotMatchesMemberApp(
  memberApp: SlackAppIdentity | null | undefined,
  bot: SlackAppIdentity,
  sharedBot: boolean
) {
  if (
    memberApp &&
    ((!sharedBot && memberApp.appId !== bot.appId) || memberApp.teamId !== bot.teamId)
  )
    throw new OrchestrationError(
      'conflict',
      'Install the same Slack app and workspace connected by your members'
    )
}

/** Replaces legacy duplicated secrets without changing member grants or their scope policies. */
export async function adoptOrganizationSlackMemberApp(
  executor: DbOrTx,
  organizationId: string,
  appId: string,
  teamId: string,
  clientId: string
) {
  const rows = await loadOrganizationSlackMemberApps(organizationId, executor)
  for (const row of rows) {
    const configuration = row.configuration.slack
    if (!configuration || 'source' in configuration) continue
    if (
      configuration.appId !== appId ||
      configuration.teamId !== teamId ||
      configuration.clientId !== clientId
    )
      throw new OrchestrationError(
        'conflict',
        'Use the same Slack app and workspace already connected by your members'
      )
    const encrypted = await encryptCredentialGroupProviderConfiguration({
      ...row.configuration,
      slack: {
        source: 'slack_app',
        appId,
        teamId,
        scopes: configuration.scopes,
        verifiedAt: configuration.verifiedAt,
      },
    })
    if (!row.encryptedConfiguration) throw new Error('Slack member configuration is missing')
    const [updated] = await executor
      .update(credentialGroup)
      .set({ encryptedProviderConfiguration: encrypted, updatedAt: new Date() })
      .where(
        and(
          eq(credentialGroup.id, row.id),
          eq(credentialGroup.organizationId, organizationId),
          eq(credentialGroup.encryptedProviderConfiguration, row.encryptedConfiguration)
        )
      )
      .returning({ id: credentialGroup.id })
    if (!updated)
      throw new OrchestrationError(
        'conflict',
        'Slack member configuration changed during app setup'
      )
  }
}
