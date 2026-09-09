import { db } from '@sim/db'
import { credential, slackSearchInstallation } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { getSlackBotCredential } from '@/lib/oauth/credential-service'
import { SLACK_CUSTOM_BOT_PROVIDER_ID } from '@/lib/oauth/types'

export type SlackSearchInstallation = typeof slackSearchInstallation.$inferSelect

export async function loadSlackSearchCredential(credentialId: string, organizationId: string) {
  const [row] = await db
    .select()
    .from(credential)
    .where(
      and(
        eq(credential.id, credentialId),
        eq(credential.organizationId, organizationId),
        eq(credential.type, 'service_account'),
        eq(credential.providerId, SLACK_CUSTOM_BOT_PROVIDER_ID)
      )
    )
    .limit(1)
  if (!row?.encryptedServiceAccountKey)
    throw new OrchestrationError('not_found', 'Organization Slack bot not found')
  const secret = await getSlackBotCredential(credentialId)
  if (!secret?.signingSecret)
    throw new OrchestrationError('validation', 'Reconnect this bot using Slack Search setup')
  return { ...secret, version: secret.credentialVersion }
}

export async function findSlackSearchInstallation(credentialId: string) {
  const [row] = await db
    .select()
    .from(slackSearchInstallation)
    .where(eq(slackSearchInstallation.credentialId, credentialId))
    .limit(1)
  return row ?? null
}

export async function recordSlackSearchOutcome(
  installation: SlackSearchInstallation,
  outcome: string
) {
  await db
    .update(slackSearchInstallation)
    .set({ lastOutcome: outcome, lastEventAt: new Date() })
    .where(
      and(
        eq(slackSearchInstallation.id, installation.id),
        eq(slackSearchInstallation.revision, installation.revision)
      )
    )
}
