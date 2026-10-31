import { db } from '@sim/db'
import { oauthClient } from '@sim/db/schema'
import { isPlainRecord } from '@sim/utils/object'
import { eq } from 'drizzle-orm'

/**
 * Server-owned marker the public registration endpoint stamps on every client
 * it creates. Clients cannot set metadata through registration and hold no
 * management privileges, so only this server writes it.
 */
const PUBLIC_REGISTRATION_METADATA = { registration: 'public' } as const

/**
 * Stamps a just-registered client and narrows it to the scope families it
 * registered for. Registration discloses the client ID only after this
 * succeeds, so an unstamped client is never usable: if the write fails, the
 * registration fails and nobody holds the ID.
 *
 * Better Auth 1.7 grants every dynamically registered client all registrable
 * scopes, so the requested `scopes` are written here. `public` is set because
 * 1.7 no longer writes it, and 1.6 pods still serving during the rollout
 * authenticate `none` clients by it.
 */
export async function markPubliclyRegisteredOAuthClient(
  clientId: string,
  scopes: string[]
): Promise<void> {
  const updated = await db
    .update(oauthClient)
    .set({ metadata: PUBLIC_REGISTRATION_METADATA, public: true, scopes })
    .where(eq(oauthClient.clientId, clientId))
    .returning({ clientId: oauthClient.clientId })
  if (updated.length !== 1) {
    throw new Error(`Registered OAuth client ${clientId} was not found to mark`)
  }
}

function readMetadata(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

/**
 * Whether a client was created through public registration rather than by an
 * operator. Such a client may reach the Sim API only through the Sim MCP
 * server, so its API grants must name that server as their resource.
 */
export async function isPubliclyRegisteredOAuthClient(clientId: string): Promise<boolean> {
  const [client] = await db
    .select({ metadata: oauthClient.metadata })
    .from(oauthClient)
    .where(eq(oauthClient.clientId, clientId))
    .limit(1)
  const metadata = readMetadata(client?.metadata)
  return (
    isPlainRecord(metadata) && metadata.registration === PUBLIC_REGISTRATION_METADATA.registration
  )
}
