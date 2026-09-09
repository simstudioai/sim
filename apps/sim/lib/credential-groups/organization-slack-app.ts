import { db } from '@sim/db'
import { credentialGroup } from '@sim/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  decryptCredentialGroupProviderConfiguration,
  encryptCredentialGroupProviderConfiguration,
} from '@/lib/credential-groups/provider-configuration'
import type { DbOrTx } from '@/lib/db/types'

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
        'Use the same Slack app and workspace already configured for member indexing'
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
