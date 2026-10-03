import { db } from '@sim/db'
import { slackApp } from '@sim/db/schema'
import { sha256Hex } from '@sim/security/hash'
import { eq } from 'drizzle-orm'
import { decryptSecret } from '@/lib/core/security/encryption'
import { getSharedSlackSearchAppConfiguration } from '@/lib/slack-search/shared-app-env'

/** Shared credentials always come from the deployment, even for previously registered apps. */
export async function resolveSlackAppCredentials(app: typeof slackApp.$inferSelect) {
  const shared = getSharedSlackSearchAppConfiguration(app.id)
  if (shared?.id === app.id) {
    if (app.kind !== 'shared' || app.organizationId !== null)
      throw new Error('The configured shared Slack app belongs to a custom installation')
    return shared
  }
  if (!app.clientId || !app.encryptedClientSecret || !app.encryptedSigningSecret)
    throw new Error('Slack app credentials are missing')
  const [client, signing] = await Promise.all([
    decryptSecret(app.encryptedClientSecret),
    decryptSecret(app.encryptedSigningSecret),
  ])
  if (!client.decrypted || !signing.decrypted) throw new Error('Slack app credentials are empty')
  return {
    id: app.id,
    kind: app.kind,
    organizationId: app.organizationId,
    clientId: app.clientId,
    clientSecret: client.decrypted,
    signingSecret: signing.decrypted,
    revision: app.revision,
  }
}

/** Authentication lookup only: an app ID selects a key, never grants organization access. */
export async function loadSlackAppConfiguration(appId: string) {
  const shared = getSharedSlackSearchAppConfiguration(appId)
  if (shared?.id === appId) return { app: shared, signingSecret: shared.signingSecret }
  const [app] = await db.select().from(slackApp).where(eq(slackApp.id, appId)).limit(1)
  if (!app) return null
  if (!app.encryptedSigningSecret) throw new Error('Slack app signing secret is missing')
  const { decrypted: signingSecret } = await decryptSecret(app.encryptedSigningSecret)
  if (!signingSecret) throw new Error('Slack app signing secret is empty')
  return { app, signingSecret }
}

/** Referenced app rotations invalidate queued work along with bot-token rotations. */
export function slackBotCredentialVersion(encryptedToken: string, appRevision?: string) {
  return sha256Hex(appRevision ? `${encryptedToken}:${appRevision}` : encryptedToken)
}
