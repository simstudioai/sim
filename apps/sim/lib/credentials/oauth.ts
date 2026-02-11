import { db } from '@sim/db'
import { account, credential, credentialMember } from '@sim/db/schema'
import { and, eq, inArray } from 'drizzle-orm'

interface SyncWorkspaceOAuthCredentialsForUserParams {
  workspaceId: string
  userId: string
}

interface SyncWorkspaceOAuthCredentialsForUserResult {
  createdCredentials: number
  updatedMemberships: number
}

/**
 * Ensures connected OAuth accounts for a user exist as workspace-scoped credentials.
 */
export async function syncWorkspaceOAuthCredentialsForUser(
  params: SyncWorkspaceOAuthCredentialsForUserParams
): Promise<SyncWorkspaceOAuthCredentialsForUserResult> {
  const { workspaceId, userId } = params

  const userAccounts = await db
    .select({
      id: account.id,
      providerId: account.providerId,
      accountId: account.accountId,
    })
    .from(account)
    .where(eq(account.userId, userId))

  if (userAccounts.length === 0) {
    return { createdCredentials: 0, updatedMemberships: 0 }
  }

  const accountIds = userAccounts.map((row) => row.id)
  const existingCredentials = await db
    .select({
      id: credential.id,
      accountId: credential.accountId,
    })
    .from(credential)
    .where(
      and(
        eq(credential.workspaceId, workspaceId),
        eq(credential.type, 'oauth'),
        inArray(credential.accountId, accountIds)
      )
    )

  const existingByAccountId = new Map(
    existingCredentials
      .filter((row): row is { id: string; accountId: string } => Boolean(row.accountId))
      .map((row) => [row.accountId, row.id])
  )

  let createdCredentials = 0
  const now = new Date()

  for (const acc of userAccounts) {
    if (existingByAccountId.has(acc.id)) {
      continue
    }

    try {
      await db.insert(credential).values({
        id: crypto.randomUUID(),
        workspaceId,
        type: 'oauth',
        displayName: acc.accountId || acc.providerId,
        providerId: acc.providerId,
        accountId: acc.id,
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
      })
      createdCredentials += 1
    } catch (error: any) {
      if (error?.code !== '23505') {
        throw error
      }
    }
  }

  const credentialRows = await db
    .select({ id: credential.id, accountId: credential.accountId })
    .from(credential)
    .where(
      and(
        eq(credential.workspaceId, workspaceId),
        eq(credential.type, 'oauth'),
        inArray(credential.accountId, accountIds)
      )
    )

  const credentialIdByAccountId = new Map(
    credentialRows
      .filter((row): row is { id: string; accountId: string } => Boolean(row.accountId))
      .map((row) => [row.accountId, row.id])
  )
  const allCredentialIds = Array.from(credentialIdByAccountId.values())
  if (allCredentialIds.length === 0) {
    return { createdCredentials, updatedMemberships: 0 }
  }

  const existingMemberships = await db
    .select({
      id: credentialMember.id,
      credentialId: credentialMember.credentialId,
      joinedAt: credentialMember.joinedAt,
    })
    .from(credentialMember)
    .where(
      and(
        inArray(credentialMember.credentialId, allCredentialIds),
        eq(credentialMember.userId, userId)
      )
    )

  const membershipByCredentialId = new Map(
    existingMemberships.map((row) => [row.credentialId, row])
  )
  let updatedMemberships = 0

  for (const credentialId of allCredentialIds) {
    const existingMembership = membershipByCredentialId.get(credentialId)
    if (existingMembership) {
      await db
        .update(credentialMember)
        .set({
          role: 'admin',
          status: 'active',
          joinedAt: existingMembership.joinedAt ?? now,
          invitedBy: userId,
          updatedAt: now,
        })
        .where(eq(credentialMember.id, existingMembership.id))
      updatedMemberships += 1
      continue
    }

    await db.insert(credentialMember).values({
      id: crypto.randomUUID(),
      credentialId,
      userId,
      role: 'admin',
      status: 'active',
      joinedAt: now,
      invitedBy: userId,
      createdAt: now,
      updatedAt: now,
    })
    updatedMemberships += 1
  }

  return { createdCredentials, updatedMemberships }
}
