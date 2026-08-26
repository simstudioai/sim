import { db } from '@sim/db'
import { credential, environment, workspaceEnvironment } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, sql } from 'drizzle-orm'
import { decryptSecret, encryptSecret } from '@/lib/core/security/encryption'
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

/**
 * Decrypts the stored values for the requested workspace secret names.
 *
 * Exists for exactly one read path: rows a workspace marked visible (unredacted),
 * whose values already print into every run log the caller can open. Every other
 * secret read stays metadata-only — callers gate on the flag BEFORE asking. A
 * name that is absent or fails to decrypt is omitted rather than failing the
 * batch, since the value is optional on the wire.
 */
export async function readWorkspaceSecretValues(params: {
  workspaceId: string
  names: readonly string[]
}): Promise<Record<string, string>> {
  if (params.names.length === 0) return {}

  const [row] = await db
    .select({ variables: workspaceEnvironment.variables })
    .from(workspaceEnvironment)
    .where(eq(workspaceEnvironment.workspaceId, params.workspaceId))
    .limit(1)
  const variables = (row?.variables as Record<string, string> | null) ?? {}

  const values: Record<string, string> = {}
  await Promise.all(
    params.names.map(async (name) => {
      const encrypted = Object.hasOwn(variables, name) ? variables[name] : undefined
      if (!encrypted) return
      try {
        const { decrypted } = await decryptSecret(encrypted)
        values[name] = decrypted
      } catch {
        // Omitted from the result; the caller's wire shape treats the value as optional.
      }
    })
  )
  return values
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
  /** Redaction opt-out on the credential row. `undefined` leaves the current setting. */
  unredacted?: boolean
}): Promise<SecretMutationResult> {
  const { workspaceId, name, value, userId, description, unredacted } = params
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
      .set({
        updatedAt,
        ...(description !== undefined ? { description } : {}),
        ...(unredacted !== undefined ? { unredacted } : {}),
      })
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

/**
 * Updates one workspace secret's metadata, leaving its stored value untouched.
 *
 * Deliberately UPDATE-only: it never encrypts, never rewrites the environment
 * variables map, and never inserts a credential row, so restoring redaction on a
 * secret costs nothing and a metadata write can never conjure a secret that does
 * not exist. A write that matches no row returns `null` and the caller answers
 * not-found rather than creating one.
 *
 * The decrypted-env cache is still invalidated on a match: `unredacted` rides the
 * environment snapshot into every run's redaction catalog, so a stale entry would
 * keep printing a value the workspace just re-redacted.
 */
export async function updateWorkspaceSecretMetadata(params: {
  workspaceId: string
  name: string
  /** `undefined` leaves any existing description untouched; `null` clears it. */
  description?: string | null
  /** `undefined` leaves the current setting. */
  unredacted?: boolean
}): Promise<SecretMutationResult | null> {
  const { workspaceId, name, description, unredacted } = params
  const updatedAt = new Date()

  const updated = await db
    .update(credential)
    .set({
      updatedAt,
      ...(description !== undefined ? { description } : {}),
      ...(unredacted !== undefined ? { unredacted } : {}),
    })
    .where(
      and(
        eq(credential.workspaceId, workspaceId),
        eq(credential.type, 'env_workspace'),
        eq(credential.envKey, name)
      )
    )
    .returning({ id: credential.id })

  if (updated.length === 0) return null

  invalidateEffectiveDecryptedEnvCache({ workspaceId })

  return { created: false, updatedAt }
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
