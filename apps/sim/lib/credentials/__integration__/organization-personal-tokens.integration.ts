/** Real storage, encryption, migration, and authorization; no external GitLab calls. */
import { db } from '@sim/db'
import {
  credential,
  credentialGroup,
  credentialGroupEnrollment,
  member,
  organization,
  permissions,
  resourcePolicy,
  user,
  workspace,
} from '@sim/db/schema'
import { sha256Hex } from '@sim/security/hash'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildOrganizationAccountAccessPolicy } from '@/lib/credential-groups/application/workspace-access-policy'
import { updateWorkspaceCredentialUseCase } from '@/lib/credentials/application/credential-crud'
import { resolvePersonalToken } from '@/lib/credentials/application/resolve-personal-token'
import { deleteCredentialUseCase } from '@/lib/credentials/application/service-account'
import { decryptPersonalToken, encryptPersonalToken } from '@/lib/credentials/gitlab-personal-token'
import {
  createPersonalTokenCredential,
  getPersonalTokenCredentials,
  updatePersonalTokenCredential,
} from '@/lib/credentials/personal-tokens'
import { listVisibleWorkspaceCredentials } from '@/lib/credentials/queries'
import { migrateGitLabPersonalTokens } from '@/scripts/migrate-gitlab-personal-tokens'

vi.mock('@/lib/core/security/input-validation.server', () => ({
  secureFetchWithValidation: async (url: string) =>
    Response.json(
      url.endsWith('/user')
        ? { id: 42, username: 'fixture', name: 'Fixture', state: 'active', bot: false }
        : { user_id: 42, active: true, revoked: false, scopes: ['api'], expires_at: null }
    ),
}))

describe('organization personal tokens', () => {
  let ids: ReturnType<typeof fixtureIds>
  const tokenSecret = 'isolated-gitlab-token-fixture'
  function fixtureIds() {
    return {
      owner: generateId(),
      other: generateId(),
      org: generateId(),
      foreignOrg: generateId(),
      first: generateId(),
      second: generateId(),
      foreign: generateId(),
      group: generateId(),
      legacyGroup: generateId(),
      enrollment: generateId(),
      token: generateId(),
    }
  }
  const identity = () => ({
    providerId: 'gitlab' as const,
    ownerUserId: ids.owner,
    subjectId: '42',
    instanceUrl: 'https://gitlab.example.test',
  })
  const principal = (userId = ids.owner) => ({
    kind: 'session' as const,
    userId,
    sessionId: 'isolated-session',
  })
  const resolve = (workspaceId = ids.second, userId = ids.owner) =>
    resolvePersonalToken.execute({
      principal: principal(userId),
      input: {
        credentialId: ids.token,
        assertedWorkspaceId: workspaceId,
        expectedProviderId: 'gitlab',
      },
    })
  const migrate = (apply = true) => migrateGitLabPersonalTokens({ organizationId: ids.org, apply })
  async function storedToken() {
    const [row] = await db.select().from(credential).where(eq(credential.id, ids.token))
    if (!row) throw new Error('Fixture token missing')
    return row
  }

  beforeEach(async () => {
    ids = fixtureIds()
    const now = new Date()
    await db.insert(user).values(
      [ids.owner, ids.other].map((id) => ({
        id,
        name: 'Token fixture',
        email: `${id}@fixture.test`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      }))
    )
    await db.insert(organization).values(
      [ids.org, ids.foreignOrg].map((id) => ({
        id,
        name: 'Token fixture organization',
        slug: id,
      }))
    )
    await db.insert(member).values([
      { id: generateId(), organizationId: ids.org, userId: ids.owner, role: 'member' },
      { id: generateId(), organizationId: ids.org, userId: ids.other, role: 'admin' },
    ])
    await db.insert(workspace).values(
      [ids.first, ids.second, ids.foreign].map((id) => ({
        id,
        name: 'Token fixture workspace',
        organizationId: id === ids.foreign ? ids.foreignOrg : ids.org,
        ownerId: ids.owner,
        billedAccountUserId: ids.owner,
      }))
    )
    await db.insert(permissions).values(
      [ids.first, ids.second, ids.foreign].flatMap((id) =>
        [ids.owner, ids.other].map((userId) => ({
          id: generateId(),
          userId,
          entityId: id,
          entityType: 'workspace' as const,
          permissionType: 'admin' as const,
        }))
      )
    )
    await db.insert(credentialGroup).values([
      {
        id: ids.group,
        organizationId: ids.org,
        publicId: generateId(),
        name: 'Connected accounts',
        options: [],
        createdBy: ids.owner,
      },
      {
        id: ids.legacyGroup,
        workspaceId: ids.first,
        publicId: generateId(),
        name: 'Legacy accounts',
        options: [],
        createdBy: ids.owner,
      },
    ])
    await db.insert(resourcePolicy).values({
      id: generateId(),
      organizationId: ids.org,
      resourceType: 'credential_group',
      resourceId: ids.group,
      document: buildOrganizationAccountAccessPolicy(ids.group, []),
      createdBy: ids.owner,
    })
    await db.insert(credentialGroupEnrollment).values({
      id: ids.enrollment,
      credentialGroupId: ids.legacyGroup,
      userId: ids.owner,
      email: `${ids.owner}@fixture.test`,
      status: 'completed',
      invitationTokenHash: sha256Hex(generateId()),
      invitationExpiresAt: now,
      invitedAt: now,
    })
    await db.insert(credential).values({
      id: ids.token,
      workspaceId: ids.first,
      type: 'personal_token',
      providerId: 'gitlab',
      displayName: 'Personal GitLab',
      createdBy: ids.owner,
      providerSubjectId: '42',
      providerTenantId: identity().instanceUrl,
      grantedScopes: ['api'],
      credentialGroupEnrollmentId: ids.enrollment,
      encryptedPersonalToken: await encryptPersonalToken({
        ...identity(),
        workspaceId: ids.first,
        accessToken: tokenSecret,
      }),
    })
  })
  afterEach(async () => {
    await db
      .delete(permissions)
      .where(inArray(permissions.entityId, [ids.first, ids.second, ids.foreign]))
    await db.delete(organization).where(inArray(organization.id, [ids.org, ids.foreignOrg]))
    await db.delete(user).where(inArray(user.id, [ids.owner, ids.other]))
  })

  it('dry-runs without changing ownership, ciphertext, or enrollments', async () => {
    const before = await storedToken()
    expect(await migrate(false)).toEqual({ mode: 'dry-run', processed: 1 })
    expect(await storedToken()).toEqual(before)
    expect(
      await db
        .select()
        .from(credentialGroupEnrollment)
        .where(eq(credentialGroupEnrollment.credentialGroupId, ids.group))
    ).toHaveLength(0)
  })

  it('creates one organization token and reconnects and rotates the same identity', async () => {
    await db.delete(credential).where(eq(credential.id, ids.token))
    const input = {
      userId: ids.owner,
      accounts: { organizationId: ids.org, credentialGroupId: ids.group },
      providerId: 'gitlab',
      apiToken: tokenSecret,
      domain: 'gitlab.example.test',
    }
    const created = await createPersonalTokenCredential(input)
    expect(created.credential).toMatchObject({
      workspaceId: null,
      organizationId: ids.org,
      createdBy: ids.owner,
    })
    const reconnected = await createPersonalTokenCredential({
      ...input,
      apiToken: 'reconnected-fixture',
    })
    expect(reconnected).toMatchObject({ created: false, credential: { id: created.credential.id } })
    await updatePersonalTokenCredential({
      credential: reconnected.credential,
      apiToken: 'rotated-fixture',
    })
    const [rotated] = await db
      .select()
      .from(credential)
      .where(eq(credential.id, created.credential.id))
    expect(rotated).toMatchObject({ workspaceId: null, organizationId: ids.org })
    await expect(
      decryptPersonalToken(rotated!.encryptedPersonalToken!, {
        ...identity(),
        organizationId: ids.org,
      })
    ).resolves.toBe('rotated-fixture')
  })

  it('preserves the credential ID, rebinds encryption, and is idempotent', async () => {
    expect(await migrate()).toEqual({ mode: 'applied', processed: 1 })
    const current = await storedToken()
    expect(current).toMatchObject({
      id: ids.token,
      workspaceId: null,
      organizationId: ids.org,
      createdBy: ids.owner,
    })
    const [enrollment] = await db
      .select()
      .from(credentialGroupEnrollment)
      .where(eq(credentialGroupEnrollment.id, current.credentialGroupEnrollmentId!))
    expect(enrollment).toMatchObject({ userId: ids.owner, credentialGroupId: ids.group })
    await expect(
      decryptPersonalToken(current.encryptedPersonalToken!, {
        ...identity(),
        organizationId: ids.org,
      })
    ).resolves.toBe(tokenSecret)
    await expect(
      decryptPersonalToken(current.encryptedPersonalToken!, {
        ...identity(),
        workspaceId: ids.first,
      })
    ).rejects.toThrow('binding')
    expect(await migrate()).toEqual({ mode: 'applied', processed: 0 })
  })

  it('uses the same connection across workspaces and survives deletion of the original workspace', async () => {
    await migrate()
    for (const workspaceId of [ids.first, ids.second]) {
      expect(
        (await getPersonalTokenCredentials(workspaceId, ids.owner)).map((row) => row.id)
      ).toEqual([ids.token])
      await expect(resolve(workspaceId)).resolves.toMatchObject({ accessToken: tokenSecret })
      const listed = await listVisibleWorkspaceCredentials({
        workspaceId,
        userId: ids.owner,
        workspaceAccess: { canAdmin: false },
        types: ['personal_token'],
      })
      expect(listed.data).toEqual([
        expect.objectContaining({ id: ids.token, workspaceId: null, organizationId: ids.org }),
      ])
    }
    await db.delete(workspace).where(eq(workspace.id, ids.first))
    await expect(resolve()).resolves.toMatchObject({ accessToken: tokenSecret })
  })

  it('denies another person, another organization, and removed organization membership', async () => {
    await migrate()
    expect(await getPersonalTokenCredentials(ids.second, ids.other)).toEqual([])
    expect(await getPersonalTokenCredentials(ids.foreign, ids.owner)).toEqual([])
    await expect(resolve(ids.second, ids.other)).rejects.toThrow()
    await expect(resolve(ids.foreign)).rejects.toThrow()
    await db
      .delete(member)
      .where(and(eq(member.organizationId, ids.org), eq(member.userId, ids.owner)))
    expect(await getPersonalTokenCredentials(ids.second, ids.owner)).toEqual([])
    await expect(resolve()).rejects.toThrow()
  })

  it('rechecks revocation before use and manages the token from another workspace', async () => {
    await migrate()
    await updateWorkspaceCredentialUseCase.execute({
      principal: principal(),
      input: {
        credentialId: ids.token,
        assertedWorkspaceId: ids.second,
        displayName: 'Renamed GitLab',
      },
    })
    expect((await storedToken()).displayName).toBe('Renamed GitLab')
    await db
      .update(credentialGroupEnrollment)
      .set({ revokedAt: new Date(), status: 'revoked' })
      .where(eq(credentialGroupEnrollment.credentialGroupId, ids.group))
    await expect(resolve()).rejects.toThrow()
    await deleteCredentialUseCase.execute({
      principal: principal(),
      input: { credentialId: ids.token, workspaceId: ids.second },
    })
    expect(await db.select().from(credential).where(eq(credential.id, ids.token))).toHaveLength(0)
  })

  it('refuses duplicate identities without choosing or overwriting a token', async () => {
    const original = await storedToken()
    await db.insert(credential).values({
      ...original,
      id: generateId(),
      workspaceId: ids.second,
      encryptedPersonalToken: await encryptPersonalToken({
        ...identity(),
        workspaceId: ids.second,
        accessToken: 'second-fixture-token',
      }),
    })
    await expect(migrate()).rejects.toThrow('Duplicate GitLab identities')
    expect(await storedToken()).toEqual(original)
  })

  it('refuses ciphertext bound to a different workspace without changing the row', async () => {
    await db
      .update(credential)
      .set({
        encryptedPersonalToken: await encryptPersonalToken({
          ...identity(),
          workspaceId: ids.second,
          accessToken: tokenSecret,
        }),
      })
      .where(eq(credential.id, ids.token))
    await expect(migrate()).rejects.toThrow('binding')
    expect((await storedToken()).workspaceId).toBe(ids.first)
  })

  it('does not revive a revoked source enrollment', async () => {
    await db
      .update(credentialGroupEnrollment)
      .set({ status: 'revoked', revokedAt: new Date() })
      .where(eq(credentialGroupEnrollment.id, ids.enrollment))
    await expect(migrate()).rejects.toThrow('inactive or mismatched')
    expect((await storedToken()).workspaceId).toBe(ids.first)
  })
})
