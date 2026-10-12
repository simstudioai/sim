/**
 * Execution environment resolution against real PostgreSQL: which identity lends the
 * personal slice and which one authorizes the workspace slice, including suspension
 * and lapsed workspace access.
 */
import { db } from '@sim/db'
import { environment, permissions, user, workspace, workspaceEnvironment } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { encryptSecret } from '@/lib/core/security/encryption'
import { getExecutionEnvironment } from '@/lib/environment/utils'

const workspaceId = generateId()
const owner = `env-owner-${generateId()}`
const actor = `env-actor-${generateId()}`
const suspended = `env-suspended-${generateId()}`
const outsider = `env-outsider-${generateId()}`
const userIds = [owner, actor, suspended, outsider]

async function encryptedVariables(values: Record<string, string>) {
  const entries = await Promise.all(
    Object.entries(values).map(async ([key, value]) => [
      key,
      (await encryptSecret(value)).encrypted,
    ])
  )
  return Object.fromEntries(entries)
}

beforeAll(async () => {
  const now = new Date()
  await db.insert(user).values(
    userIds.map((id) => ({
      id,
      name: id,
      email: `${id}@environment.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
      ...(id === suspended ? { banned: true } : {}),
    }))
  )
  await db.insert(workspace).values({
    id: workspaceId,
    name: 'Environment',
    ownerId: owner,
    billedAccountUserId: actor,
  })
  await db.insert(permissions).values(
    [owner, actor, suspended].map((userId) => ({
      id: generateId(),
      userId,
      entityType: 'workspace',
      entityId: workspaceId,
      permissionType: 'admin' as const,
    }))
  )
  await db.insert(workspaceEnvironment).values({
    id: generateId(),
    workspaceId,
    variables: await encryptedVariables({ SHARED: 'workspace-value' }),
  })
  await db.insert(environment).values(
    await Promise.all(
      userIds.map(async (userId) => ({
        id: userId,
        userId,
        variables: await encryptedVariables({ PERSONAL: `${userId}-personal` }),
      }))
    )
  )
})

afterAll(async () => {
  await db.delete(workspace).where(eq(workspace.id, workspaceId))
  await db.delete(user).where(inArray(user.id, userIds))
})

describe('getExecutionEnvironment', () => {
  it('lends the personal slice of an identity that is both owner and actor', async () => {
    const env = await getExecutionEnvironment(owner, owner, workspaceId)

    expect(env.personalDecrypted).toEqual({ PERSONAL: `${owner}-personal` })
    expect(env.workspaceDecrypted).toEqual({ SHARED: 'workspace-value' })
  })

  it('keeps the owner personal slice and the actor workspace slice when they differ', async () => {
    const env = await getExecutionEnvironment(owner, actor, workspaceId)

    expect(env.personalDecrypted).toEqual({ PERSONAL: `${owner}-personal` })
    expect(env.workspaceDecrypted).toEqual({ SHARED: 'workspace-value' })
  })

  it('withholds a suspended identity personal slice when it is also the actor', async () => {
    const env = await getExecutionEnvironment(suspended, suspended, workspaceId)

    expect(env.personalDecrypted).toEqual({})
    expect(env.personalEncrypted).toEqual({})
    expect(env.workspaceDecrypted).toEqual({ SHARED: 'workspace-value' })
  })

  it('withholds a suspended owner personal slice and resolves the actor workspace slice', async () => {
    const env = await getExecutionEnvironment(suspended, actor, workspaceId)

    expect(env.personalDecrypted).toEqual({})
    expect(env.workspaceDecrypted).toEqual({ SHARED: 'workspace-value' })
  })

  it('lends no personal slice from an identity that cannot reach the workspace', async () => {
    const env = await getExecutionEnvironment(outsider, actor, workspaceId)

    expect(env.personalDecrypted).toEqual({})
    expect(env.workspaceDecrypted).toEqual({ SHARED: 'workspace-value' })
  })

  it('refuses when neither identity can reach the workspace', async () => {
    await expect(getExecutionEnvironment(outsider, outsider, workspaceId)).rejects.toThrow(
      /Access denied/
    )
  })
})
