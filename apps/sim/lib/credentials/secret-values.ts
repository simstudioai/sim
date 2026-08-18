import { db } from '@sim/db'
import { credential, environment, workspaceEnvironment } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, sql } from 'drizzle-orm'
import { encryptSecret } from '@/lib/core/security/encryption'
import {
  createWorkspaceEnvCredentials,
  deletePersonalEnvCredentialForUser,
  deleteWorkspaceEnvCredentials,
  upsertPersonalEnvCredentialForUser,
} from '@/lib/credentials/environment'
import type { DbOrTx } from '@/lib/db/types'
import { invalidateEffectiveDecryptedEnvCache } from '@/lib/environment/utils'

const SECRET_MAP_LOCK_TIMEOUT_MS = 5_000

export interface SecretMutationResult {
  created: boolean
  updatedAt: Date
}

async function lockSecretMap(tx: DbOrTx, lockKey: string): Promise<void> {
  await tx.execute(
    sql`SELECT set_config('lock_timeout', ${`${SECRET_MAP_LOCK_TIMEOUT_MS}ms`}, true)`
  )
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`)
}

/** Stores one workspace secret without decrypting any existing value. */
export async function setWorkspaceSecret(params: {
  workspaceId: string
  name: string
  value: string
  userId: string
  /**
   * Teammate-facing note on the credential row. `undefined` leaves any existing
   * description untouched so rotating a value can't silently erase it; `null`
   * clears it.
   */
  description?: string | null
}): Promise<SecretMutationResult> {
  const { workspaceId, name, value, userId, description } = params
  const { encrypted } = await encryptSecret(value)
  const updatedAt = new Date()

  const created = await db.transaction(async (tx) => {
    await lockSecretMap(tx, workspaceId)
    const [row] = await tx
      .select({
        id: workspaceEnvironment.id,
        variables: workspaceEnvironment.variables,
        createdAt: workspaceEnvironment.createdAt,
      })
      .from(workspaceEnvironment)
      .where(eq(workspaceEnvironment.workspaceId, workspaceId))
      .limit(1)

    const variables = { ...((row?.variables as Record<string, string> | null) ?? {}) }
    const existed = Object.hasOwn(variables, name)
    variables[name] = encrypted

    await tx
      .insert(workspaceEnvironment)
      .values({
        id: row?.id ?? generateId(),
        workspaceId,
        variables,
        createdAt: row?.createdAt ?? updatedAt,
        updatedAt,
      })
      .onConflictDoUpdate({
        target: [workspaceEnvironment.workspaceId],
        set: { variables, updatedAt },
      })

    await createWorkspaceEnvCredentials({
      workspaceId,
      newKeys: [name],
      actingUserId: userId,
      updatedAt,
      executor: tx,
    })
    await tx
      .update(credential)
      .set(description === undefined ? { updatedAt } : { updatedAt, description })
      .where(
        and(
          eq(credential.workspaceId, workspaceId),
          eq(credential.type, 'env_workspace'),
          eq(credential.envKey, name)
        )
      )

    return !existed
  })

  invalidateEffectiveDecryptedEnvCache({ workspaceId })

  return { created, updatedAt }
}

/** Stores one caller-owned personal secret without decrypting any existing value. */
export async function setPersonalSecret(params: {
  userId: string
  name: string
  value: string
}): Promise<SecretMutationResult> {
  const { userId, name, value } = params
  const { encrypted } = await encryptSecret(value)
  const updatedAt = new Date()

  const created = await db.transaction(async (tx) => {
    await lockSecretMap(tx, userId)
    const [row] = await tx
      .select({ id: environment.id, variables: environment.variables })
      .from(environment)
      .where(eq(environment.userId, userId))
      .limit(1)

    const variables = { ...((row?.variables as Record<string, string> | null) ?? {}) }
    const existed = Object.hasOwn(variables, name)
    variables[name] = encrypted

    await tx
      .insert(environment)
      .values({
        id: row?.id ?? generateId(),
        userId,
        variables,
        updatedAt,
      })
      .onConflictDoUpdate({
        target: [environment.userId],
        set: { variables, updatedAt },
      })

    await upsertPersonalEnvCredentialForUser({
      userId,
      envKey: name,
      updatedAt,
      executor: tx,
    })

    return !existed
  })

  invalidateEffectiveDecryptedEnvCache({ userId })

  return { created, updatedAt }
}

/** Removes one workspace secret without reading or decrypting its value. */
export async function deleteWorkspaceSecret(params: {
  workspaceId: string
  name: string
}): Promise<boolean> {
  const { workspaceId, name } = params

  const deleted = await db.transaction(async (tx) => {
    await lockSecretMap(tx, workspaceId)
    const [row] = await tx
      .select({ variables: workspaceEnvironment.variables })
      .from(workspaceEnvironment)
      .where(eq(workspaceEnvironment.workspaceId, workspaceId))
      .limit(1)

    const variables = { ...((row?.variables as Record<string, string> | null) ?? {}) }
    if (!Object.hasOwn(variables, name)) return false
    delete variables[name]

    await tx
      .update(workspaceEnvironment)
      .set({ variables, updatedAt: new Date() })
      .where(eq(workspaceEnvironment.workspaceId, workspaceId))
    await deleteWorkspaceEnvCredentials({
      workspaceId,
      removedKeys: [name],
      executor: tx,
    })
    return true
  })

  if (!deleted) return false
  invalidateEffectiveDecryptedEnvCache({ workspaceId })
  return true
}

/** Removes one caller-owned personal secret without reading or decrypting its value. */
export async function deletePersonalSecret(params: {
  userId: string
  name: string
}): Promise<boolean> {
  const { userId, name } = params

  const deleted = await db.transaction(async (tx) => {
    await lockSecretMap(tx, userId)
    const [row] = await tx
      .select({ variables: environment.variables })
      .from(environment)
      .where(eq(environment.userId, userId))
      .limit(1)

    const variables = { ...((row?.variables as Record<string, string> | null) ?? {}) }
    if (!Object.hasOwn(variables, name)) return false
    delete variables[name]

    await tx
      .update(environment)
      .set({ variables, updatedAt: new Date() })
      .where(eq(environment.userId, userId))
    await deletePersonalEnvCredentialForUser({ userId, envKey: name, executor: tx })
    return true
  })

  if (!deleted) return false
  invalidateEffectiveDecryptedEnvCache({ userId })
  return true
}
