import { db } from '@sim/db'
import { slackApp } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { eq, sql } from 'drizzle-orm'
import { encryptSecret } from '@/lib/core/security/encryption'

const logger = createLogger('RegisterPlatformSlackApp')

/** Explicit deployment preparation; never chooses an app identity from an unauthenticated event. */
async function main() {
  const appId = process.argv[2]
  const clientId = process.env.SLACK_CLIENT_ID
  const clientSecret = process.env.SLACK_CLIENT_SECRET
  const signingSecret = process.env.SLACK_SIGNING_SECRET
  if (!appId || !/^A[A-Z0-9]+$/.test(appId) || !clientId || !clientSecret || !signingSecret)
    throw new Error(
      'Supply the verified platform Slack app ID and SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, SLACK_SIGNING_SECRET'
    )
  const [client, signing] = await Promise.all([
    encryptSecret(clientSecret),
    encryptSecret(signingSecret),
  ])
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`slack-app:${appId}`}, 0))`
    )
    const [existing] = await tx
      .select({ kind: slackApp.kind })
      .from(slackApp)
      .where(eq(slackApp.id, appId))
      .for('update')
      .limit(1)
    if (existing && existing.kind !== 'shared')
      throw new Error('The app ID already belongs to a custom app')
    const values = {
      id: appId,
      kind: 'shared' as const,
      organizationId: null,
      clientId,
      encryptedClientSecret: client.encrypted,
      encryptedSigningSecret: signing.encrypted,
      revision: generateId(),
      updatedAt: new Date(),
    }
    await tx
      .insert(slackApp)
      .values(values)
      .onConflictDoUpdate({ target: slackApp.id, set: values })
  })
  logger.info('Registered platform Slack app', { appId })
}

await main()
process.exit(0)
