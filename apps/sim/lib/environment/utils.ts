import { db } from '@sim/db'
import { environment, workspaceEnvironment } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq, inArray } from 'drizzle-orm'
import { decryptSecret } from '@/lib/core/security/encryption'
import { getAccessibleEnvCredentials } from '@/lib/credentials/environment'

const logger = createLogger('EnvironmentUtils')

/**
 * Get environment variable keys for a user
 * Returns only the variable names, not their values
 */
export async function getEnvironmentVariableKeys(userId: string): Promise<{
  variableNames: string[]
  count: number
}> {
  try {
    const result = await db
      .select()
      .from(environment)
      .where(eq(environment.userId, userId))
      .limit(1)

    if (!result.length || !result[0].variables) {
      return {
        variableNames: [],
        count: 0,
      }
    }

    // Get the keys (variable names) without decrypting values
    const encryptedVariables = result[0].variables as Record<string, string>
    const variableNames = Object.keys(encryptedVariables)

    return {
      variableNames,
      count: variableNames.length,
    }
  } catch (error) {
    logger.error('Error getting environment variable keys:', error)
    throw new Error('Failed to get environment variables')
  }
}

export async function getPersonalAndWorkspaceEnv(
  userId: string,
  workspaceId?: string
): Promise<{
  personalEncrypted: Record<string, string>
  workspaceEncrypted: Record<string, string>
  personalDecrypted: Record<string, string>
  workspaceDecrypted: Record<string, string>
  conflicts: string[]
  decryptionFailures: string[]
}> {
  const [personalRows, workspaceRows, accessibleEnvCredentials] = await Promise.all([
    db.select().from(environment).where(eq(environment.userId, userId)).limit(1),
    workspaceId
      ? db
          .select()
          .from(workspaceEnvironment)
          .where(eq(workspaceEnvironment.workspaceId, workspaceId))
          .limit(1)
      : Promise.resolve([] as any[]),
    workspaceId ? getAccessibleEnvCredentials(workspaceId, userId) : Promise.resolve([]),
  ])

  const ownPersonalEncrypted: Record<string, string> = (personalRows[0]?.variables as any) || {}
  const allWorkspaceEncrypted: Record<string, string> = (workspaceRows[0]?.variables as any) || {}

  const hasCredentialFiltering = Boolean(workspaceId) && accessibleEnvCredentials.length > 0
  const workspaceCredentialKeys = new Set(
    accessibleEnvCredentials.filter((row) => row.type === 'env_workspace').map((row) => row.envKey)
  )

  const personalCredentialRows = accessibleEnvCredentials
    .filter((row) => row.type === 'env_personal' && row.envOwnerUserId)
    .sort((a, b) => {
      const aIsRequester = a.envOwnerUserId === userId
      const bIsRequester = b.envOwnerUserId === userId
      if (aIsRequester && !bIsRequester) return -1
      if (!aIsRequester && bIsRequester) return 1
      return b.updatedAt.getTime() - a.updatedAt.getTime()
    })

  const selectedPersonalOwners = new Map<string, string>()
  for (const row of personalCredentialRows) {
    if (!selectedPersonalOwners.has(row.envKey) && row.envOwnerUserId) {
      selectedPersonalOwners.set(row.envKey, row.envOwnerUserId)
    }
  }

  const ownerUserIds = Array.from(new Set(selectedPersonalOwners.values()))
  const ownerEnvironmentRows =
    ownerUserIds.length > 0
      ? await db
          .select({
            userId: environment.userId,
            variables: environment.variables,
          })
          .from(environment)
          .where(inArray(environment.userId, ownerUserIds))
      : []

  const ownerVariablesByUserId = new Map<string, Record<string, string>>(
    ownerEnvironmentRows.map((row) => [row.userId, (row.variables as Record<string, string>) || {}])
  )

  let personalEncrypted: Record<string, string> = ownPersonalEncrypted
  let workspaceEncrypted: Record<string, string> = allWorkspaceEncrypted

  if (hasCredentialFiltering) {
    personalEncrypted = {}
    for (const [envKey, ownerUserId] of selectedPersonalOwners.entries()) {
      const ownerVariables = ownerVariablesByUserId.get(ownerUserId)
      const encryptedValue = ownerVariables?.[envKey]
      if (encryptedValue) {
        personalEncrypted[envKey] = encryptedValue
      }
    }

    workspaceEncrypted = Object.fromEntries(
      Object.entries(allWorkspaceEncrypted).filter(([envKey]) =>
        workspaceCredentialKeys.has(envKey)
      )
    )
  }

  const decryptionFailures: string[] = []

  const decryptAll = async (src: Record<string, string>, source: 'personal' | 'workspace') => {
    const entries = Object.entries(src)
    const results = await Promise.all(
      entries.map(async ([k, v]) => {
        try {
          const { decrypted } = await decryptSecret(v)
          return [k, decrypted] as const
        } catch (error) {
          logger.error(`Failed to decrypt ${source} environment variable "${k}"`, {
            userId,
            workspaceId,
            source,
            error: error instanceof Error ? error.message : 'Unknown error',
          })
          decryptionFailures.push(k)
          return [k, ''] as const
        }
      })
    )
    return Object.fromEntries(results)
  }

  const [personalDecrypted, workspaceDecrypted] = await Promise.all([
    decryptAll(personalEncrypted, 'personal'),
    decryptAll(workspaceEncrypted, 'workspace'),
  ])

  const conflicts = Object.keys(personalEncrypted).filter((k) => k in workspaceEncrypted)

  if (decryptionFailures.length > 0) {
    logger.warn('Some environment variables failed to decrypt', {
      userId,
      workspaceId,
      failedKeys: decryptionFailures,
      failedCount: decryptionFailures.length,
    })
  }

  return {
    personalEncrypted,
    workspaceEncrypted,
    personalDecrypted,
    workspaceDecrypted,
    conflicts,
    decryptionFailures,
  }
}

export async function getEffectiveDecryptedEnv(
  userId: string,
  workspaceId?: string
): Promise<Record<string, string>> {
  const { personalDecrypted, workspaceDecrypted } = await getPersonalAndWorkspaceEnv(
    userId,
    workspaceId
  )
  return { ...personalDecrypted, ...workspaceDecrypted }
}
