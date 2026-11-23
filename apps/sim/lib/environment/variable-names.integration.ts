/**
 * The names-only env read against real PostgreSQL: for every grant shape it must list exactly
 * the names the values path resolves, so a workflow source never offers `env.NAME` the run
 * cannot read, nor hides one it can.
 */
import { db } from '@sim/db'
import {
  credential,
  credentialMember,
  environment,
  permissions,
  user,
  workspace,
  workspaceEnvironment,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { generateId } from '@sim/utils/id'
import { compareStrings } from '@sim/utils/string'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { encryptSecret } from '@/lib/core/security/encryption'
import {
  getEffectiveEnvironmentSnapshot,
  getWorkspaceEnvironmentVariableNames,
} from '@/lib/environment/utils'

const workspaceId = generateId()
const admin = `names-admin-${generateId()}`
const granted = `names-granted-${generateId()}`
const ungranted = `names-ungranted-${generateId()}`
const sharer = `names-sharer-${generateId()}`
const userIds = [admin, granted, ungranted, sharer]

async function encryptedVariables(values: Record<string, string>) {
  const entries = await Promise.all(
    Object.entries(values).map(async ([key, value]) => [
      key,
      value === '' ? '' : (await encryptSecret(value)).encrypted,
    ])
  )
  return Object.fromEntries(entries)
}

/** The names the values path resolves: the keys of both accessible encrypted slices. */
async function resolvedNames(userId: string): Promise<string[]> {
  const snapshot = await getEffectiveEnvironmentSnapshot(userId, workspaceId)
  return [
    ...new Set([
      ...Object.keys(snapshot.personalEncrypted),
      ...Object.keys(snapshot.workspaceEncrypted),
    ]),
  ].sort(compareStrings)
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
    }))
  )
  await insertWorkspaceFixture(db, {
    id: workspaceId,
    name: 'Env names',
    ownerId: admin,
    billedAccountUserId: admin,
  })
  await db.insert(permissions).values([
    {
      id: generateId(),
      userId: admin,
      entityType: 'workspace',
      entityId: workspaceId,
      permissionType: 'admin' as const,
    },
    ...[granted, ungranted, sharer].map((userId) => ({
      id: generateId(),
      userId,
      entityType: 'workspace',
      entityId: workspaceId,
      permissionType: 'write' as const,
    })),
  ])
  await db.insert(workspaceEnvironment).values({
    id: generateId(),
    workspaceId,
    variables: await encryptedVariables({
      WS_GRANTED: 'granted',
      WS_HIDDEN: 'hidden',
      WS_LEGACY: 'no credential row',
    }),
  })
  await db.insert(environment).values([
    {
      id: generateId(),
      userId: granted,
      variables: await encryptedVariables({ GRANTED_OWN: 'own', SHARED_KEY: 'own copy' }),
    },
    {
      id: generateId(),
      userId: ungranted,
      variables: await encryptedVariables({ UNGRANTED_OWN: 'own' }),
    },
    {
      id: generateId(),
      userId: sharer,
      variables: await encryptedVariables({ SHARED_KEY: 'shared', SHARED_EMPTY: '' }),
    },
  ])
  const grantedCredentialIds = [generateId(), generateId(), generateId()]
  const [workspaceGrant, sharedGrant, emptySharedGrant] = grantedCredentialIds
  await db.insert(credential).values([
    {
      id: workspaceGrant,
      workspaceId,
      type: 'env_workspace',
      displayName: 'WS_GRANTED',
      envKey: 'WS_GRANTED',
      createdBy: admin,
    },
    {
      id: generateId(),
      workspaceId,
      type: 'env_workspace',
      displayName: 'WS_HIDDEN',
      envKey: 'WS_HIDDEN',
      createdBy: admin,
    },
    {
      id: sharedGrant,
      workspaceId,
      type: 'env_personal',
      displayName: 'SHARED_KEY',
      envKey: 'SHARED_KEY',
      envOwnerUserId: sharer,
      createdBy: sharer,
    },
    {
      id: emptySharedGrant,
      workspaceId,
      type: 'env_personal',
      displayName: 'SHARED_EMPTY',
      envKey: 'SHARED_EMPTY',
      envOwnerUserId: sharer,
      createdBy: sharer,
    },
  ])
  await db.insert(credentialMember).values(
    grantedCredentialIds.map((credentialId) => ({
      id: generateId(),
      credentialId,
      userId: granted,
      role: 'member' as const,
      status: 'active' as const,
    }))
  )
})

afterAll(async () => {
  await deleteWorkspaceFixture(db, eq(workspace.id, workspaceId))
  await db.delete(environment).where(inArray(environment.userId, userIds))
  await db.delete(user).where(inArray(user.id, userIds))
})

describe('getWorkspaceEnvironmentVariableNames', () => {
  it.each([
    ['a workspace admin', admin, ['WS_GRANTED', 'WS_HIDDEN', 'WS_LEGACY']],
    [
      'a member with workspace and shared personal grants',
      granted,
      ['GRANTED_OWN', 'SHARED_KEY', 'WS_GRANTED'],
    ],
    ['a member with no grants', ungranted, ['UNGRANTED_OWN']],
    ['the owner of a shared personal key', sharer, ['SHARED_EMPTY', 'SHARED_KEY']],
  ])(
    'lists for %s exactly the names the values path resolves',
    async (_shape, userId, expected) => {
      const names = await getWorkspaceEnvironmentVariableNames(userId, workspaceId)

      expect(names).toEqual(expected)
      expect(names).toEqual(await resolvedNames(userId))
    }
  )
})
