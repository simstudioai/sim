import { db } from '@sim/db'
import { account, credential } from '@sim/db/schema'
import { and, eq, ne } from 'drizzle-orm'
import { getEnrolledManagedOAuthCredentials } from '@/lib/credentials/environment'

export interface PersonalOAuthCredential {
  id: string
  providerId: string
  displayName: string
  type: 'oauth' | 'managed_oauth'
  updatedAt: Date
  connectedAt: Date
}

/** Accounts whose provider identity belongs to the person, independently of workspace sharing. */
export async function getPersonalOAuthCredentials(
  workspaceId: string,
  userId: string,
  credentialId?: string
): Promise<PersonalOAuthCredential[]> {
  const ownedQuery = db
    .select({
      id: credential.id,
      providerId: credential.providerId,
      displayName: credential.displayName,
      updatedAt: credential.updatedAt,
      connectedAt: credential.createdAt,
    })
    .from(credential)
    .innerJoin(account, eq(account.id, credential.accountId))
    .where(
      and(
        eq(credential.workspaceId, workspaceId),
        credentialId === undefined ? undefined : eq(credential.id, credentialId),
        eq(credential.type, 'oauth'),
        eq(account.userId, userId),
        eq(account.providerId, credential.providerId),
        /** Ordinary Slack OAuth stores an installation's bot token, not its installer's token. */
        ne(credential.providerId, 'slack')
      )
    )
  const [owned, enrolled] = await Promise.all([
    credentialId === undefined ? ownedQuery : ownedQuery.limit(1),
    getEnrolledManagedOAuthCredentials(workspaceId, userId, credentialId),
  ])
  return [
    ...owned.flatMap((row) =>
      row.providerId ? [{ ...row, providerId: row.providerId, type: 'oauth' as const }] : []
    ),
    ...enrolled.map(({ id, providerId, displayName, updatedAt, connectedAt }) => ({
      id,
      providerId,
      displayName,
      updatedAt,
      connectedAt,
      type: 'managed_oauth' as const,
    })),
  ]
}
