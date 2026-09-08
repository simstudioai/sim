import { db } from '@sim/db'
import { credential, slackSearchInstallation } from '@sim/db/schema'
import { sha256Hex } from '@sim/security/hash'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { decryptSecret } from '@/lib/core/security/encryption'
import { SLACK_CUSTOM_BOT_PROVIDER_ID, SLACK_CUSTOM_BOT_SECRET_TYPE } from '@/lib/oauth/types'

const secretSchema = z.object({
  type: z.literal(SLACK_CUSTOM_BOT_SECRET_TYPE),
  botToken: z.string().min(1),
  signingSecret: z.string().min(1),
})

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
  const { decrypted } = await decryptSecret(row.encryptedServiceAccountKey)
  const parsed = secretSchema.safeParse(JSON.parse(decrypted))
  if (!parsed.success)
    throw new OrchestrationError(
      'validation',
      'Reconnect this bot with its bot token and signing secret'
    )
  return { ...parsed.data, version: sha256Hex(row.encryptedServiceAccountKey) }
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
