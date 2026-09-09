import { db } from '@sim/db'
import { slackApp } from '@sim/db/schema'
import { sha256Hex } from '@sim/security/hash'
import { eq } from 'drizzle-orm'
import { decryptSecret } from '@/lib/core/security/encryption'

/** Authentication lookup only: an app ID selects a key, never grants organization access. */
export async function loadSlackAppConfiguration(appId: string) {
  const [app] = await db.select().from(slackApp).where(eq(slackApp.id, appId)).limit(1)
  if (!app) return null
  const { decrypted: signingSecret } = await decryptSecret(app.encryptedSigningSecret)
  if (!signingSecret) throw new Error('Slack app signing secret is empty')
  return { app, signingSecret }
}

/** Referenced app rotations invalidate queued work along with bot-token rotations. */
export function slackBotCredentialVersion(encryptedToken: string, appRevision?: string) {
  return sha256Hex(appRevision ? `${encryptedToken}:${appRevision}` : encryptedToken)
}
