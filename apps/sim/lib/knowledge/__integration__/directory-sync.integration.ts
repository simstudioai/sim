/** Real directory persistence, source sync status, retry scheduling, and concurrent-write guards. */
import { db } from '@sim/db'
import {
  credential,
  credentialGroup,
  credentialGroupEnrollment,
  document,
  knowledgeConnector,
  knowledgeConnectorSyncLog,
  knowledgeExternalDirectory,
  knowledgeExternalGroup,
  knowledgeExternalGroupMember,
  user,
  workspace,
} from '@sim/db/schema'
import { createMockRequest } from '@sim/testing'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  listGroups: vi.fn(),
  members: vi.fn(),
  listDocuments: vi.fn(),
  enqueue: vi.fn(async (_type: string, _payload: unknown) => 'job'),
}))
vi.mock('@/lib/auth/internal', () => ({ verifyCronAuth: () => null }))
vi.mock('@/lib/core/async-jobs', () => ({
  getJobQueue: async () => ({ enqueue: fixture.enqueue }),
}))
vi.mock('@/connectors/registry.server', () => ({
  CONNECTOR_REGISTRY: {
    confluence: {
      id: 'confluence',
      name: 'Directory fixture',
      auth: { mode: 'apiKey', optional: true },
      listDocuments: fixture.listDocuments,
      getDocument: async () => {
        throw new Error('Unexpected hydration')
      },
      openDirectory: async () => ({
        providerId: 'confluence',
        tenantId: 'fixture-tenant',
        listGroups: fixture.listGroups,
        listGroupMembers: fixture.members,
      }),
    },
  },
}))

import { resolveBillingAttribution } from '@/lib/billing/core/billing-attribution'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
  seedKnowledgeMemberFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { resolveUserKnowledgeAccessScope } from '@/lib/knowledge/access/scope'
import { groupToken } from '@/lib/knowledge/access/tokens'
import {
  refreshConnectorDirectory,
  syncExternalDirectoryGroups,
} from '@/lib/knowledge/connectors/external-group-sync'
import { executeSync } from '@/lib/knowledge/connectors/sync-engine'
import { GET as scheduleDirectories } from '@/app/api/knowledge/connectors/directory-sync/route'
import { executeDirectorySyncJob } from '@/background/knowledge-connector-directory-sync'
import type { ConnectorDirectory, ConnectorDirectoryGroup } from '@/connectors/types'

describe('directory failure visibility in PostgreSQL', () => {
  const ids = createKnowledgeAclFixtureIds()
  const old = new Date('2026-01-01T00:00:00Z')
  let billing: Awaited<ReturnType<typeof resolveBillingAttribution>>

  beforeAll(async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('Unexpected outbound request')
    })
    await seedKnowledgeAclFixture(ids)
    billing = await resolveBillingAttribution({
      actorUserId: ids.aliceId,
      workspaceId: ids.workspaceId,
    })
  })
  beforeEach(async () => {
    await db
      .delete(knowledgeExternalDirectory)
      .where(eq(knowledgeExternalDirectory.workspaceId, ids.workspaceId))
    await db.delete(document).where(eq(document.connectorId, ids.connectorId))
    fixture.listGroups.mockReset().mockResolvedValue(ids.groups.map((id) => ({ id })))
    fixture.members.mockReset().mockImplementation(async (group: ConnectorDirectoryGroup) => ({
      group,
      memberTokens: [`u:${ids.aliceId}@fixture.test`],
      complete: true,
    }))
    fixture.listDocuments.mockReset().mockResolvedValue({ documents: [], hasMore: false })
    await db
      .update(knowledgeConnector)
      .set({
        status: 'active',
        syncLockToken: null,
        lastSyncAt: null,
        lastSyncError: null,
        consecutiveFailures: 0,
        listingCheckpoint: null,
        nextDirectorySyncAt: new Date(0),
        sourceConfig: {},
        updatedAt: new Date(),
      })
      .where(eq(knowledgeConnector.id, ids.connectorId))
    await db
      .update(knowledgeExternalGroup)
      .set({ lastSyncedAt: old })
      .where(eq(knowledgeExternalGroup.workspaceId, ids.workspaceId))
  })
  afterAll(async () => {
    await db.delete(workspace).where(eq(workspace.id, ids.workspaceId))
    await db.delete(user).where(eq(user.id, ids.aliceId))
    await db.delete(user).where(eq(user.id, ids.bobId))
    await db.$client.end()
    vi.unstubAllGlobals()
  })

  async function source() {
    const [row] = await db
      .select()
      .from(knowledgeConnector)
      .where(eq(knowledgeConnector.id, ids.connectorId))
    return row
  }

  function directoryFixture(tenantId = generateId()): ConnectorDirectory {
    return {
      providerId: 'lease-fixture',
      tenantId,
      listGroups: async () => [{ id: 'group' }],
      listGroupMembers: async (group) => ({
        group,
        memberTokens: ['u:alice@fixture.test'],
        complete: true,
      }),
    }
  }
  function directoryWhere(directory: ConnectorDirectory) {
    return and(
      eq(knowledgeExternalDirectory.workspaceId, ids.workspaceId),
      eq(knowledgeExternalDirectory.providerId, directory.providerId),
      eq(knowledgeExternalDirectory.tenantId, directory.tenantId)
    )
  }
  function groupsWhere(directory: ConnectorDirectory) {
    return and(
      eq(knowledgeExternalGroup.workspaceId, ids.workspaceId),
      eq(knowledgeExternalGroup.providerId, directory.providerId),
      eq(knowledgeExternalGroup.tenantId, directory.tenantId)
    )
  }
  function deferred() {
    let resolve!: () => void
    const promise = new Promise<void>((done) => {
      resolve = done
    })
    return { promise, resolve }
  }

  it('advances past the first 200 directories, including microsecond timestamps and competing ticks', async () => {
    const connectors = Array.from({ length: 201 }, () => ({
      id: generateId(),
      knowledgeBaseId: ids.knowledgeBaseId,
      connectorType: 'confluence',
      sourceConfig: {},
      accessMode: 'admin',
      nextDirectorySyncAt: sql`'2000-01-01 00:00:00.123456'::timestamp`,
    }))
    await db
      .update(knowledgeConnector)
      .set({ nextDirectorySyncAt: new Date('2099-01-01') })
      .where(eq(knowledgeConnector.id, ids.connectorId))
    await db.insert(knowledgeConnector).values(connectors)
    fixture.enqueue.mockClear()
    try {
      await Promise.all([
        scheduleDirectories(createMockRequest('GET'), {}),
        scheduleDirectories(createMockRequest('GET'), {}),
      ])
      await scheduleDirectories(createMockRequest('GET'), {})
      const dispatchedIds = fixture.enqueue.mock.calls.map((call) => {
        const payload = call[1] as { connectorId: string }
        return payload.connectorId
      })
      expect(dispatchedIds).toHaveLength(201)
      expect(new Set(dispatchedIds)).toEqual(new Set(connectors.map((row) => row.id)))
    } finally {
      await db.delete(knowledgeConnector).where(
        inArray(
          knowledgeConnector.id,
          connectors.map((row) => row.id)
        )
      )
    }
  })

  it('retries a failed enqueue on the next due tick without repeating it immediately', async () => {
    const now = Date.now()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(now)
    fixture.enqueue.mockClear().mockRejectedValueOnce(new Error('Queue unavailable'))
    try {
      const first = await scheduleDirectories(createMockRequest('GET'), {})
      expect(await first.json()).toMatchObject({ failed: 1 })
      await scheduleDirectories(createMockRequest('GET'), {})
      expect(fixture.enqueue).toHaveBeenCalledTimes(1)
      vi.setSystemTime(now + 5 * 60 * 1000)
      const retry = await scheduleDirectories(createMockRequest('GET'), {})
      expect(await retry.json()).toMatchObject({ dispatched: 1, failed: 0 })
      expect(fixture.enqueue).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it.each(['paused', 'disabled'])(
    'does not refresh a connector that became %s after dispatch',
    async (status) => {
      await db
        .update(knowledgeConnector)
        .set({ status })
        .where(eq(knowledgeConnector.id, ids.connectorId))
      await expect(refreshConnectorDirectory(ids.connectorId, 'stale-job')).resolves.toBe('skipped')
      expect(fixture.listGroups).not.toHaveBeenCalled()
    }
  )

  it('lets only one connector fetch a shared directory while its lease is held', async () => {
    const directory = directoryFixture()
    const entered = deferred()
    const release = deferred()
    directory.listGroups = async () => {
      entered.resolve()
      await release.promise
      return []
    }
    const first = syncExternalDirectoryGroups({ workspaceId: ids.workspaceId, directory })
    await entered.promise
    const other = directoryFixture(directory.tenantId)
    other.listGroups = vi.fn().mockResolvedValue([])
    await expect(
      syncExternalDirectoryGroups({ workspaceId: ids.workspaceId, directory: other, force: true })
    ).resolves.toMatchObject({ skipped: true })
    expect(other.listGroups).not.toHaveBeenCalled()
    release.resolve()
    await first
  })

  it.each(['revocation', 'prune'] as const)(
    'fences an old worker after a newer %s',
    async (kind) => {
      const directory = directoryFixture()
      await syncExternalDirectoryGroups({ workspaceId: ids.workspaceId, directory })
      const entered = deferred()
      const release = deferred()
      const stale = directoryFixture(directory.tenantId)
      if (kind === 'prune')
        stale.listGroups = async () => {
          entered.resolve()
          await release.promise
          return [{ id: 'group' }]
        }
      else
        stale.listGroupMembers = async (group) => {
          entered.resolve()
          await release.promise
          return { group, memberTokens: ['u:alice@fixture.test'], complete: true }
        }
      const first = syncExternalDirectoryGroups({
        workspaceId: ids.workspaceId,
        directory: stale,
        force: true,
      }).catch((error: unknown) => error)
      await entered.promise
      await db
        .update(knowledgeExternalDirectory)
        .set({ syncLockLeaseAt: new Date(0) })
        .where(directoryWhere(directory))
      const replacement = directoryFixture(directory.tenantId)
      if (kind === 'prune') replacement.listGroups = async () => []
      replacement.listGroupMembers = async (group) => ({ group, memberTokens: [], complete: true })
      await syncExternalDirectoryGroups({ workspaceId: ids.workspaceId, directory: replacement })
      const [completed] = await db
        .select()
        .from(knowledgeExternalDirectory)
        .where(directoryWhere(directory))
      release.resolve()
      expect(await first).toMatchObject({ message: 'Directory sync lease expired or was replaced' })
      const groups = await db.select().from(knowledgeExternalGroup).where(groupsWhere(directory))
      if (kind === 'prune') expect(groups).toHaveLength(0)
      else
        expect(
          await db
            .select()
            .from(knowledgeExternalGroupMember)
            .where(eq(knowledgeExternalGroupMember.groupId, groups[0].id))
        ).toHaveLength(0)
      expect(
        await db.select().from(knowledgeExternalDirectory).where(directoryWhere(directory))
      ).toEqual([completed])
    }
  )

  it('rereads a first pass interrupted after only one fresh group was inserted', async () => {
    const directory = directoryFixture()
    await db.insert(knowledgeExternalDirectory).values({
      workspaceId: ids.workspaceId,
      providerId: directory.providerId,
      tenantId: directory.tenantId,
      syncLockToken: generateId(),
      syncLockLeaseAt: new Date(0),
      lastStartedAt: new Date(),
    })
    await db.insert(knowledgeExternalGroup).values({
      id: generateId(),
      workspaceId: ids.workspaceId,
      providerId: directory.providerId,
      tenantId: directory.tenantId,
      externalGroupId: 'first',
      lastSyncedAt: new Date(),
    })
    directory.listGroups = vi.fn().mockResolvedValue([{ id: 'first' }, { id: 'second' }])
    await expect(
      syncExternalDirectoryGroups({ workspaceId: ids.workspaceId, directory })
    ).resolves.toMatchObject({ refreshed: 2, skipped: false })
    expect(directory.listGroups).toHaveBeenCalledOnce()
    expect(
      await db.select().from(knowledgeExternalGroup).where(groupsWhere(directory))
    ).toHaveLength(2)
  })

  it('caches a completed empty directory without deriving completion from group rows', async () => {
    const directory = directoryFixture()
    directory.listGroups = vi.fn().mockResolvedValue([])
    await expect(
      syncExternalDirectoryGroups({ workspaceId: ids.workspaceId, directory })
    ).resolves.toMatchObject({ skipped: false })
    await expect(
      syncExternalDirectoryGroups({ workspaceId: ids.workspaceId, directory })
    ).resolves.toMatchObject({ skipped: true })
    expect(directory.listGroups).toHaveBeenCalledOnce()
    const [completed] = await db
      .select()
      .from(knowledgeExternalDirectory)
      .where(directoryWhere(directory))
    expect(completed.lastCompleteSyncAt).not.toBeNull()
  })

  it('prunes more than one bounded batch before publishing directory completion', async () => {
    const directory = directoryFixture()
    await db.insert(knowledgeExternalGroup).values(
      Array.from({ length: 501 }, (_, index) => ({
        id: generateId(),
        workspaceId: ids.workspaceId,
        providerId: directory.providerId,
        tenantId: directory.tenantId,
        externalGroupId: `removed-${index}`,
        lastSyncedAt: new Date(),
      }))
    )
    directory.listGroups = async () => []
    await expect(
      syncExternalDirectoryGroups({ workspaceId: ids.workspaceId, directory })
    ).resolves.toMatchObject({ pruned: 501, skipped: false })
    expect(
      await db.select().from(knowledgeExternalGroup).where(groupsWhere(directory))
    ).toHaveLength(0)
    const [completed] = await db
      .select()
      .from(knowledgeExternalDirectory)
      .where(directoryWhere(directory))
    expect(completed.lastCompleteSyncAt).not.toBeNull()
  })

  it.each(['upsert', 'membership', 'prune'] as const)(
    'fences expired %s writes even without a replacement worker',
    async (phase) => {
      const directory = directoryFixture()
      await syncExternalDirectoryGroups({ workspaceId: ids.workspaceId, directory })
      const expire = () =>
        db
          .update(knowledgeExternalDirectory)
          .set({ syncLockLeaseAt: new Date(0) })
          .where(directoryWhere(directory))
      if (phase === 'membership')
        directory.listGroupMembers = async (group) => {
          await expire()
          return { group, memberTokens: [], complete: true }
        }
      else
        directory.listGroups = async () => {
          await expire()
          return phase === 'prune' ? [] : [{ id: 'new-group' }]
        }
      await expect(
        syncExternalDirectoryGroups({ workspaceId: ids.workspaceId, directory, force: true })
      ).rejects.toThrow('lease expired')
      const groups = await db.select().from(knowledgeExternalGroup).where(groupsWhere(directory))
      expect(groups.map((group) => group.externalGroupId)).toEqual(['group'])
      expect(
        await db
          .select()
          .from(knowledgeExternalGroupMember)
          .where(eq(knowledgeExternalGroupMember.groupId, groups[0].id))
      ).toEqual([expect.objectContaining({ subjectToken: 'u:alice@fixture.test' })])
      const [failed] = await db
        .select()
        .from(knowledgeExternalDirectory)
        .where(directoryWhere(directory))
      expect(failed.lastStartedAt!.getTime()).toBeGreaterThanOrEqual(
        failed.lastCompleteSyncAt!.getTime()
      )
    }
  )

  it('keeps incomplete membership and freshness, fails the worker, then retries despite other fresh groups', async () => {
    fixture.members.mockImplementation(async (group: ConnectorDirectoryGroup) => ({
      group,
      memberTokens: [],
      complete: group.id !== ids.groups[0],
    }))
    await expect(
      executeDirectorySyncJob({ connectorId: ids.connectorId, requestId: generateId() })
    ).rejects.toThrow('Directory refresh failed: 1 group memberships could not be refreshed')
    const [group] = await db
      .select()
      .from(knowledgeExternalGroup)
      .where(eq(knowledgeExternalGroup.id, ids.groupIds[0]))
    expect(group.lastSyncedAt).toEqual(old)
    const members = await db
      .select()
      .from(knowledgeExternalGroupMember)
      .where(eq(knowledgeExternalGroupMember.groupId, ids.groupIds[0]))
    expect(members.map((row) => row.subjectToken)).toContain(`u:${ids.aliceId}@fixture.test`)
    expect((await source()).lastSyncError).toContain('Directory refresh failed')

    fixture.members.mockImplementation(async (entry: ConnectorDirectoryGroup) => ({
      group: entry,
      memberTokens: [],
      complete: true,
    }))
    await expect(refreshConnectorDirectory(ids.connectorId, generateId())).resolves.toBe(
      'refreshed'
    )
    expect((await source()).lastSyncError).toBeNull()
    expect(
      await db
        .select()
        .from(knowledgeExternalGroupMember)
        .where(eq(knowledgeExternalGroupMember.groupId, ids.groupIds[0]))
    ).toHaveLength(0)
  })

  it('reports a directory failure after an empty content crawl and recovers on a later sync', async () => {
    fixture.listGroups.mockRejectedValue(new Error('Directory API HTTP 403'))
    const result = await executeSync(ids.connectorId, { billingAttribution: billing })
    expect(result.error).toBe('Directory refresh failed: Directory API HTTP 403')
    expect(fixture.listDocuments).toHaveBeenCalledOnce()
    const failed = await source()
    expect(failed.status).toBe('error')
    expect(failed.lastSyncAt).toBeNull()
    expect(failed.syncLockToken).toBeNull()
    expect(failed.consecutiveFailures).toBe(1)
    expect(failed.nextSyncAt!.getTime()).toBeGreaterThan(Date.now())
    const logs = await db
      .select()
      .from(knowledgeConnectorSyncLog)
      .where(
        and(
          eq(knowledgeConnectorSyncLog.connectorId, ids.connectorId),
          eq(knowledgeConnectorSyncLog.status, 'failed')
        )
      )
    expect(logs.some((log) => log.errorMessage === result.error)).toBe(true)

    fixture.listGroups.mockResolvedValue(ids.groups.map((id) => ({ id })))
    const retry = await executeSync(ids.connectorId, {
      billingAttribution: billing,
      fullSync: true,
    })
    expect(retry.error).toBeUndefined()
    expect(await source()).toMatchObject({
      status: 'active',
      lastSyncError: null,
      consecutiveFailures: 0,
    })
  })

  it('finishes content pages and independent document ACLs while reporting a directory failure', async () => {
    const pages = ['first', 'second']
    await db.insert(document).values(
      pages.map((externalId) => ({
        id: generateId(),
        knowledgeBaseId: ids.knowledgeBaseId,
        connectorId: ids.connectorId,
        externalId,
        filename: externalId,
        fileUrl: 'data:text/plain,fixture',
        fileSize: 7,
        mimeType: 'text/plain',
        contentHash: `hash-${externalId}`,
        processingStatus: 'completed',
        acl: [],
      }))
    )
    fixture.listDocuments.mockImplementation(async (_token, _config, cursor) => {
      const externalId = cursor ? pages[1] : pages[0]
      return {
        documents: [
          {
            externalId,
            title: externalId,
            content: 'fixture',
            contentHash: `hash-${externalId}`,
            mimeType: 'text/plain',
            acl: ['pub'],
          },
        ],
        hasMore: !cursor,
        nextCursor: cursor ? undefined : 'second-page',
      }
    })
    fixture.listGroups.mockRejectedValue(new Error('Directory unavailable'))
    const result = await executeSync(ids.connectorId, { billingAttribution: billing })
    expect(result).toMatchObject({
      docsUnchanged: 2,
      error: 'Directory refresh failed: Directory unavailable',
    })
    expect(fixture.listDocuments).toHaveBeenCalledTimes(2)
    const indexed = await db
      .select()
      .from(document)
      .where(eq(document.connectorId, ids.connectorId))
    expect(indexed.every((entry) => entry.acl[0] === 'pub' && entry.aclVerifiedAt !== null)).toBe(
      true
    )
  })

  it('does not hide a failed forced refresh behind an earlier fresh snapshot', async () => {
    await expect(refreshConnectorDirectory(ids.connectorId, generateId())).resolves.toBe(
      'refreshed'
    )
    fixture.listGroups.mockRejectedValue(new Error('Directory unavailable'))
    expect(
      (await executeSync(ids.connectorId, { billingAttribution: billing, fullSync: true })).error
    ).toContain('Directory unavailable')
    fixture.listGroups.mockClear()
    expect((await executeSync(ids.connectorId, { billingAttribution: billing })).error).toContain(
      'Directory unavailable'
    )
    expect(fixture.listGroups).toHaveBeenCalledOnce()
    fixture.listGroups.mockResolvedValue(ids.groups.map((id) => ({ id })))
    await expect(refreshConnectorDirectory(ids.connectorId, generateId())).resolves.toBe(
      'refreshed'
    )
    expect(fixture.listGroups).toHaveBeenCalledTimes(2)
  })

  it.each(['settings', 'lease'] as const)(
    'does not overwrite a concurrent %s change with a background failure',
    async (change) => {
      const token = generateId()
      fixture.listGroups.mockImplementation(async () => {
        await db
          .update(knowledgeConnector)
          .set(
            change === 'settings'
              ? {
                  sourceConfig: { revision: 2 },
                  lastSyncError: 'New settings status',
                  updatedAt: new Date(Date.now() + 1000),
                }
              : { status: 'syncing', syncLockToken: token, lastSyncError: 'Active sync status' }
          )
          .where(eq(knowledgeConnector.id, ids.connectorId))
        throw new Error('Old directory request failed')
      })
      await expect(refreshConnectorDirectory(ids.connectorId, generateId())).rejects.toThrow(
        'Old directory request failed'
      )
      const current = await source()
      expect(current.lastSyncError).toBe(
        change === 'settings' ? 'New settings status' : 'Active sync status'
      )
      if (change === 'lease') expect(current.syncLockToken).toBe(token)
    }
  )
  it('resolves a provider-subject membership and revokes it on every live identity boundary', async () => {
    const members = await seedKnowledgeMemberFixture(ids)
    const member = members.members[0]
    const directory: ConnectorDirectory = {
      providerId: 'google-drive',
      tenantId: 'fixture-domain',
      listGroups: async () => [{ id: 'identity-only' }],
      listGroupMembers: async (group) => ({
        group,
        memberTokens: [member.subjectToken],
        complete: true,
      }),
    }
    const expectedGroup = groupToken({
      providerId: directory.providerId,
      tenantId: directory.tenantId,
      groupId: 'identity-only',
    })!
    await syncExternalDirectoryGroups({ workspaceId: ids.workspaceId, directory, force: true })
    const hasGroup = async () =>
      (await resolveUserKnowledgeAccessScope(ids.aliceId, ids.workspaceId)).tokens.some(
        (token) => token === expectedGroup
      )
    expect(await hasGroup()).toBe(true)
    expect(
      (await resolveUserKnowledgeAccessScope(ids.bobId, ids.workspaceId)).tokens
    ).not.toContain(expectedGroup)

    await db
      .update(credential)
      .set({ managedOauthStatus: 'revoked' })
      .where(eq(credential.id, member.credentialId))
    expect(await hasGroup()).toBe(false)
    await db
      .update(credential)
      .set({ managedOauthStatus: 'active' })
      .where(eq(credential.id, member.credentialId))
    await db
      .update(credentialGroupEnrollment)
      .set({ status: 'revoked' })
      .where(eq(credentialGroupEnrollment.id, member.enrollmentId))
    expect(await hasGroup()).toBe(false)
    await db
      .update(credentialGroupEnrollment)
      .set({ status: 'completed' })
      .where(eq(credentialGroupEnrollment.id, member.enrollmentId))
    await db
      .update(credentialGroup)
      .set({ status: 'disabled' })
      .where(eq(credentialGroup.id, members.groupId))
    expect(await hasGroup()).toBe(false)
    await db
      .update(credentialGroup)
      .set({ status: 'active' })
      .where(eq(credentialGroup.id, members.groupId))
    const [group] = await db
      .select()
      .from(credentialGroup)
      .where(eq(credentialGroup.id, members.groupId))
    await db
      .update(credentialGroup)
      .set({ options: group.options.map((option) => ({ ...option, status: 'disabled' as const })) })
      .where(eq(credentialGroup.id, members.groupId))
    expect(await hasGroup()).toBe(false)
    await db
      .update(credentialGroup)
      .set({ options: group.options })
      .where(eq(credentialGroup.id, members.groupId))
    await db.update(user).set({ emailVerified: false }).where(eq(user.id, ids.aliceId))
    expect(await hasGroup()).toBe(false)
    await db.update(user).set({ emailVerified: true }).where(eq(user.id, ids.aliceId))
    expect(await hasGroup()).toBe(true)

    directory.listGroupMembers = async (sourceGroup) => ({
      group: sourceGroup,
      memberTokens: [`s:google-drive:another-tenant:${ids.aliceId}`],
      complete: true,
    })
    await syncExternalDirectoryGroups({ workspaceId: ids.workspaceId, directory, force: true })
    expect(await hasGroup()).toBe(false)
    const mixedSubject = 'Opaque:MixedCaseSubject'
    directory.listGroupMembers = async (sourceGroup) => ({
      group: sourceGroup,
      memberTokens: [`s:google-drive:fixture-domain:${mixedSubject}`],
      complete: true,
    })
    await db
      .update(credential)
      .set({ providerSubjectId: mixedSubject.toLowerCase() })
      .where(eq(credential.id, member.credentialId))
    await syncExternalDirectoryGroups({ workspaceId: ids.workspaceId, directory, force: true })
    expect(await hasGroup()).toBe(false)
    await db
      .update(credential)
      .set({ providerSubjectId: mixedSubject })
      .where(eq(credential.id, member.credentialId))
    expect(await hasGroup()).toBe(true)

    directory.listGroupMembers = async (sourceGroup) => ({
      group: sourceGroup,
      memberTokens: ['ws'],
      complete: true,
    })
    await expect(
      syncExternalDirectoryGroups({ workspaceId: ids.workspaceId, directory, force: true })
    ).rejects.toThrow('invalid identity token')
    expect(await hasGroup()).toBe(true)
    await db
      .update(knowledgeExternalGroup)
      .set({ lastSyncedAt: old })
      .where(
        and(
          eq(knowledgeExternalGroup.workspaceId, ids.workspaceId),
          eq(knowledgeExternalGroup.providerId, directory.providerId)
        )
      )
    expect(await hasGroup()).toBe(false)
  })
})
