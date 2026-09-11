import { credentialGroup } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { credentialGroupScopePolicyVersion } from '@/lib/credential-groups/provider-adapter'
import {
  decryptCredentialGroupProviderConfiguration,
  encryptCredentialGroupProviderConfiguration,
} from '@/lib/credential-groups/provider-configuration'
import { ensureWorkspaceAccountsGroup } from '@/lib/credential-groups/service'
import { SLACK_SEARCH_USER_SCOPES } from '@/lib/credential-groups/slack-managed-user-scopes'
import type { DbOrTx } from '@/lib/db/types'

/** Configures personal consent atomically with the authorized admin's bot installation. */
export async function configureSharedSlackMemberApp(
  tx: DbOrTx,
  input: {
    organizationId: string
    userId: string
    appId: string
    teamId: string
  }
) {
  const container = await ensureWorkspaceAccountsGroup(
    { kind: 'organization', organizationId: input.organizationId },
    input.userId,
    undefined,
    tx
  )
  const [group] = await tx
    .select()
    .from(credentialGroup)
    .where(eq(credentialGroup.id, container.id))
    .for('update')
    .limit(1)
  if (!group) throw new Error('Organization accounts configuration disappeared')
  const configuration = await decryptCredentialGroupProviderConfiguration(
    group.encryptedProviderConfiguration
  )
  if (
    configuration.slack &&
    (configuration.slack.appId !== input.appId || configuration.slack.teamId !== input.teamId)
  )
    throw new OrchestrationError(
      'conflict',
      'Remove the previous Slack source configuration before installing another app'
    )
  const existing = group.options.find((option) => option.provider === 'slack')
  const requiredScopes = [...SLACK_SEARCH_USER_SCOPES]
  const authorizationAppId = `slack:${input.appId}:${input.teamId}`
  const scopeVersion = credentialGroupScopePolicyVersion(requiredScopes)
  if (
    existing &&
    (existing.authorizationAppId !== authorizationAppId || existing.scopeVersion !== scopeVersion)
  )
    throw new OrchestrationError(
      'conflict',
      'Remove the previous Slack connection configuration before switching Slack apps'
    )
  const option = {
    id: existing?.id ?? generateId(),
    provider: 'slack',
    label: 'Slack',
    authorizationAppId,
    requiredScopes,
    scopeVersion,
    required: false,
    status: 'active' as const,
  }
  await tx
    .update(credentialGroup)
    .set({
      options: existing
        ? group.options.map((entry) => (entry.id === existing.id ? option : entry))
        : [...group.options, option],
      encryptedProviderConfiguration: await encryptCredentialGroupProviderConfiguration({
        ...configuration,
        slack: {
          source: 'slack_app',
          appId: input.appId,
          teamId: input.teamId,
          scopes: requiredScopes,
          verifiedAt: new Date().toISOString(),
        },
      }),
      updatedAt: new Date(),
    })
    .where(eq(credentialGroup.id, group.id))
}
