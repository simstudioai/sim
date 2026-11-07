import { db } from '@sim/db'
import {
  credential,
  credentialMember,
  member,
  organization,
  organizationSearchIntegration,
  user,
} from '@sim/db/schema'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { createDeferred } from '@sim/testing/helpers/deferred'
import {
  credentialGroupsAvailabilityMock,
  credentialGroupsAvailabilityMockFns,
} from '@sim/testing/mocks/credential-groups-availability.mock'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SaveSearchPersonalCredentialBody } from '@/lib/api/contracts/search-personal-credentials'
import {
  removeSearchPersonalCredential,
  saveSearchPersonalCredential,
} from '@/lib/credentials/application/search-personal-credentials'
import type { ServiceAccountSecretResult } from '@/lib/credentials/service-account-secret'

const verifier = vi.hoisted(() => vi.fn())
vi.mock('@/lib/credential-groups/scoped-availability', () => credentialGroupsAvailabilityMock)
vi.mock('@/lib/credentials/service-account-secret', () => ({
  verifyAndBuildServiceAccountSecret: verifier,
}))

/** Real transactions and authorization guard private provider credentials while verification is in flight. */
describe('personal Search connections in PostgreSQL', () => {
  const userId = generateId()
  const adminId = generateId()
  const organizationId = generateId()
  const otherOrganizationId = generateId()
  const email = `${userId}@personal-search.test`
  const principal = createSessionPrincipal({ userId })
  const admin = createSessionPrincipal({ userId: adminId })
  const input: SaveSearchPersonalCredentialBody = {
    organizationId,
    providerId: 'jama-service-account',
    orgId: 'https://requirements.example.test/jama',
    clientId: 'fixture-client',
    clientSecret: 'fixture-secret',
  }

  function verified(
    overrides: Partial<ServiceAccountSecretResult> = {}
  ): ServiceAccountSecretResult {
    return {
      providerId: 'jama-service-account',
      encryptedServiceAccountKey: 'fixture-encrypted-provider-secret',
      displayName: email,
      principal: { kind: 'user', id: '42', label: email },
      auditMetadata: {},
      ...overrides,
    }
  }

  const ownRows = () =>
    db.select().from(credential).where(eq(credential.organizationId, organizationId))
  const save = (overrides: Partial<SaveSearchPersonalCredentialBody> = {}) =>
    saveSearchPersonalCredential.execute({ principal, input: { ...input, ...overrides } })

  beforeAll(async () => {
    await db.insert(user).values(
      [userId, adminId].map((id) => ({
        id,
        name: 'Personal Search fixture',
        email: id === userId ? email : `${id}@personal-search.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }))
    )
    await db.insert(organization).values(
      [organizationId, otherOrganizationId].map((id) => ({
        id,
        name: 'Personal Search fixture',
        slug: id,
        createdAt: new Date(),
      }))
    )
  })

  beforeEach(async () => {
    credentialGroupsAvailabilityMockFns.mockIsScopedCredentialGroupsAvailable.mockReset()
    verifier.mockReset().mockResolvedValue(verified())
    await db
      .delete(credential)
      .where(inArray(credential.organizationId, [organizationId, otherOrganizationId]))
    await db
      .delete(member)
      .where(inArray(member.organizationId, [organizationId, otherOrganizationId]))
    await db.insert(member).values([
      { id: generateId(), organizationId, userId, role: 'member', createdAt: new Date() },
      { id: generateId(), organizationId, userId: adminId, role: 'admin', createdAt: new Date() },
    ])
    await db.update(user).set({ email, emailVerified: true }).where(eq(user.id, userId))
    await db
      .insert(organizationSearchIntegration)
      .values(
        [organizationId, otherOrganizationId].flatMap((id) =>
          ['jama', 'flow'].map((connectorType) => ({
            organizationId: id,
            connectorType,
            approved: true,
          }))
        )
      )
      .onConflictDoUpdate({
        target: [
          organizationSearchIntegration.organizationId,
          organizationSearchIntegration.connectorType,
        ],
        set: { approved: true },
      })
  })

  afterAll(async () => {
    await db
      .delete(organization)
      .where(inArray(organization.id, [organizationId, otherOrganizationId]))
    await db.delete(user).where(inArray(user.id, [userId, adminId]))
  })

  it('refuses provider verification and persistence when connected accounts are unavailable', async () => {
    credentialGroupsAvailabilityMockFns.mockIsScopedCredentialGroupsAvailable.mockResolvedValueOnce(
      false
    )
    await expect(save()).rejects.toMatchObject({ code: 'not_found' })
    expect(verifier).not.toHaveBeenCalled()
    expect(await ownRows()).toEqual([])
  })

  it('still removes a personal connection after connected accounts become unavailable', async () => {
    const created = await save()
    credentialGroupsAvailabilityMockFns.mockIsScopedCredentialGroupsAvailable.mockResolvedValue(
      false
    )
    await removeSearchPersonalCredential.execute({
      principal,
      input: { organizationId, ...created },
    })
    expect(await ownRows()).toEqual([])
  })

  it('creates a private connection, rotates its secret, and removes its membership with it', async () => {
    const created = await save()
    expect(await ownRows()).toMatchObject([
      {
        id: created.credentialId,
        createdBy: userId,
        workspaceId: null,
        providerSubjectId: '42',
        providerTenantId: input.orgId,
      },
    ])
    expect(
      await db
        .select()
        .from(credentialMember)
        .where(eq(credentialMember.credentialId, created.credentialId))
    ).toMatchObject([{ userId, role: 'admin', status: 'active' }])
    verifier.mockResolvedValue(verified({ encryptedServiceAccountKey: 'rotated-fixture-secret' }))
    await save({ credentialId: created.credentialId })
    expect(await ownRows()).toMatchObject([
      { encryptedServiceAccountKey: 'rotated-fixture-secret' },
    ])
    await removeSearchPersonalCredential.execute({
      principal,
      input: { organizationId, ...created },
    })
    expect(await ownRows()).toEqual([])
    expect(
      await db
        .select()
        .from(credentialMember)
        .where(eq(credentialMember.credentialId, created.credentialId))
    ).toEqual([])
  })

  it.each(['different_email', 'unverified_email', 'non_user'] as const)(
    'does not persist a credential with %s identity',
    async (mode) => {
      if (mode === 'unverified_email') {
        await db.update(user).set({ emailVerified: false }).where(eq(user.id, userId))
      } else {
        verifier.mockResolvedValue(
          verified({
            principal:
              mode === 'non_user'
                ? null
                : { kind: 'user', id: '42', label: 'someone-else@personal-search.test' },
          })
        )
      }
      await expect(save()).rejects.toMatchObject({ code: 'validation' })
      expect(await ownRows()).toEqual([])
    }
  )

  it.each(['membership', 'approval', 'email'] as const)(
    'rechecks %s changed while the provider verified the credential',
    async (changed) => {
      const started = createDeferred<void>()
      const resume = createDeferred<ServiceAccountSecretResult>()
      verifier.mockImplementationOnce(() => {
        started.resolve()
        return resume.promise
      })
      const pending = save()
      const outcome = pending.catch((error: unknown) => error)
      await started.promise
      if (changed === 'membership') {
        await db
          .delete(member)
          .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
      } else if (changed === 'approval') {
        await db
          .update(organizationSearchIntegration)
          .set({ approved: false })
          .where(
            and(
              eq(organizationSearchIntegration.organizationId, organizationId),
              eq(organizationSearchIntegration.connectorType, 'jama')
            )
          )
      } else {
        await db
          .update(user)
          .set({ email: `changed-${email}` })
          .where(eq(user.id, userId))
      }
      resume.resolve(verified())
      expect(await outcome).toMatchObject({
        code:
          changed === 'membership'
            ? 'not_found'
            : changed === 'approval'
              ? 'forbidden'
              : 'validation',
      })
      expect(await ownRows()).toEqual([])
    }
  )

  it.each(['tenant', 'subject'] as const)(
    'refuses to replace the %s on a reconnect',
    async (changed) => {
      const created = await save()
      if (changed === 'subject') {
        verifier.mockResolvedValue(
          verified({ principal: { kind: 'user', id: '43', label: email } })
        )
      }
      await expect(
        save({
          ...created,
          ...(changed === 'tenant' ? { orgId: 'https://other.example.test/jama' } : {}),
        })
      ).rejects.toMatchObject({ failure: 'account_mismatch', statusCode: 409 })
      expect(await ownRows()).toMatchObject([
        { providerSubjectId: '42', providerTenantId: input.orgId },
      ])
    }
  )

  it('binds a Flow connection to its origin and workspace when reconnecting', async () => {
    verifier.mockResolvedValue(verified({ providerId: 'flow-service-account' }))
    const flow: Partial<SaveSearchPersonalCredentialBody> = {
      providerId: 'flow-service-account',
      domain: 'https://flow.example.test',
      providerWorkspaceId: 'workspace-a',
      apiToken: 'fixture-token',
    }
    const created = await save(flow)
    await expect(
      save({ ...flow, ...created, providerWorkspaceId: 'workspace-b' })
    ).rejects.toMatchObject({ failure: 'account_mismatch', statusCode: 409 })
    await expect(
      save({ ...flow, ...created, domain: 'https://other-flow.example.test' })
    ).rejects.toMatchObject({ failure: 'account_mismatch', statusCode: 409 })
    expect(await ownRows()).toMatchObject([
      { providerTenantId: '["https://flow.example.test","workspace-a"]' },
    ])
  })

  it('conceals a personal credential from other organization admins and from another tenant', async () => {
    const created = await save()
    await expect(
      saveSearchPersonalCredential.execute({ principal: admin, input: { ...input, ...created } })
    ).rejects.toMatchObject({ code: 'not_found' })
    await expect(
      removeSearchPersonalCredential.execute({
        principal: admin,
        input: { organizationId, ...created },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
    await db
      .update(member)
      .set({ organizationId: otherOrganizationId })
      .where(eq(member.userId, userId))
    await expect(save({ ...created, organizationId: otherOrganizationId })).rejects.toMatchObject({
      code: 'not_found',
    })
    await expect(
      removeSearchPersonalCredential.execute({
        principal,
        input: { organizationId: otherOrganizationId, ...created },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(await ownRows()).toHaveLength(1)
  })

  it('serializes concurrent connections at the per-member account limit', async () => {
    await db.insert(credential).values(
      Array.from({ length: 99 }, () => ({
        id: generateId(),
        organizationId,
        createdBy: userId,
        providerId: 'coda-service-account',
        displayName: 'Limit fixture',
        type: 'service_account' as const,
      }))
    )
    verifier.mockResolvedValueOnce(
      verified({ principal: { kind: 'user', id: '43', label: email } })
    )
    const results = await Promise.allSettled([save(), save()])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toMatchObject([
      { reason: { code: 'validation' } },
    ])
    expect(await ownRows()).toHaveLength(100)
  })

  it('allows only one concurrent connection for the same verified provider identity', async () => {
    const results = await Promise.allSettled([save(), save()])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toMatchObject([
      { reason: { failure: 'account_already_connected', statusCode: 409 } },
    ])
    expect(await ownRows()).toHaveLength(1)
  })

  it('limits concurrent additions per provider while allowing reconnect at the limit', async () => {
    const ids: string[] = []
    for (let index = 0; index < 4; index++) {
      verifier.mockResolvedValueOnce(
        verified({ principal: { kind: 'user', id: `member-${index}`, label: email } })
      )
      ids.push((await save()).credentialId)
    }
    verifier.mockResolvedValueOnce(
      verified({ principal: { kind: 'user', id: '43', label: email } })
    )
    const results = await Promise.allSettled([save(), save()])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toMatchObject([
      { reason: { failure: 'account_limit_reached', statusCode: 409 } },
    ])
    verifier.mockResolvedValueOnce(
      verified({
        principal: { kind: 'user', id: 'member-0', label: email },
        encryptedServiceAccountKey: 'rotated-at-limit',
      })
    )
    await save({ credentialId: ids[0] })
    const rows = await ownRows()
    expect(rows).toHaveLength(5)
    expect(rows.find((row) => row.id === ids[0])?.encryptedServiceAccountKey).toBe(
      'rotated-at-limit'
    )
  })
})
