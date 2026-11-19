/** Real PostgreSQL coverage for staged CSV integrity and active-generation authorization. */
import { db } from '@sim/db'
import {
  knowledgeConnectorPermissionImportGrant as grants,
  knowledgeConnectorPermissionImportIdentity as identities,
  knowledgeConnectorPermissionImport as imports,
  knowledgeConnector,
  organization,
  user,
  workspace,
} from '@sim/db/schema'
import { deleteWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PermissionImportManifest } from '@/lib/api/contracts/v2/source-permission-imports'
import type { DbTransaction } from '@/lib/db/types'
import { seedKnowledgeAclFixture } from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { loadConnectorPermissionGroupTokens } from '@/lib/knowledge/access/connector-permissions'
import {
  appendPermissionImportPart,
  loadPermissionImport,
  permissionImportSummaries,
  validatePermissionImportScope,
} from '@/lib/knowledge/connectors/permission-import-store'
import {
  connectorsGrantingSubject,
  hasConnectorPermissionGrant,
  readConnectorPermissionGrants,
  writeConnectorPermissions,
} from '@/lib/knowledge/connectors/permission-store'
import { connectorPermissionGroupToken } from '@/lib/knowledge/connectors/permission-tokens'
import {
  gitLabPermissionData,
  loadGitLabPermissionSnapshot,
  prepareGitLabPermissions,
} from '@/connectors/gitlab/permission-config/repository'

describe('permission import persistence and access', () => {
  const owners: Awaited<ReturnType<typeof seedKnowledgeAclFixture>>[] = []
  const metadata = {
    host: 'https://gitlab.example.com',
    group: { id: 1, path: 'engineering', includeSubgroups: true },
    projects: [
      { id: 11, path: 'engineering/allowed' },
      { id: 12, path: 'engineering/other' },
    ],
    mode: 'csv' as const,
    userMapping: { filename: 'users.csv', uploadedAt: new Date(0).toISOString(), rowCount: 1 },
    projectPermissions: {
      filename: 'permissions.csv',
      uploadedAt: new Date(0).toISOString(),
      rowCount: 1,
    },
  }

  beforeAll(async () => {
    owners.push(await seedKnowledgeAclFixture())
    owners.push(await seedKnowledgeAclFixture())
  })
  afterAll(async () => {
    for (const owner of owners) {
      await deleteWorkspaceFixture(db, eq(workspace.id, owner.workspaceId))
      await db.delete(organization).where(eq(organization.id, owner.organizationId))
      await db.delete(user).where(inArray(user.id, [owner.aliceId, owner.bobId]))
    }
    await db.$client.end()
  })

  async function source(owner = owners[0]) {
    const id = generateId()
    await db.insert(knowledgeConnector).values({
      id,
      knowledgeBaseId: owner.knowledgeBaseId,
      connectorType: 'gitlab',
      sourceConfig: { scope: 'group', host: metadata.host, group: '1', includeSubgroups: 'true' },
      accessMode: 'admin',
    })
    return id
  }

  async function locked<T>(connectorId: string, run: (tx: DbTransaction) => Promise<T>) {
    return db.transaction(async (tx) => {
      await tx
        .select({ id: knowledgeConnector.id })
        .from(knowledgeConnector)
        .where(eq(knowledgeConnector.id, connectorId))
        .for('update')
      return run(tx)
    })
  }

  async function createImport(
    connectorId: string,
    expectedRevision: number,
    options: Partial<Pick<PermissionImportManifest, 'userMapping' | 'projectPermissions'>> = {}
  ) {
    const id = generateId()
    await db.insert(imports).values({
      id,
      connectorId,
      credentialBinding: 'key:fixture:fixture',
      expectedRevision,
      metadata,
      manifest: {
        provider: 'gitlab',
        expectedRevision,
        userMapping: { filename: 'users.csv', parts: 1, rowCount: 1 },
        projectPermissions: { filename: 'permissions.csv', parts: 1, rowCount: 1 },
        ...options,
      },
      expiresAt: new Date(Date.now() + 60_000),
    })
    return id
  }

  async function append(
    connectorId: string,
    importId: string,
    part: Parameters<typeof appendPermissionImportPart>[2]
  ) {
    return locked(connectorId, async (tx) => {
      const [record] = await tx
        .select()
        .from(imports)
        .where(and(eq(imports.id, importId), eq(imports.connectorId, connectorId)))
        .for('update')
      if (!record) throw new Error('Import fixture is missing')
      return appendPermissionImportPart(tx, record, part)
    })
  }

  async function publish(connectorId: string, importId: string, expectedRevision: number) {
    return locked(connectorId, async (tx) => {
      const revision = await writeConnectorPermissions(tx, connectorId, {
        expectedRevision,
        metadata,
        payload: { importId },
        groups: [],
      })
      await tx.update(imports).set({ completedRevision: revision }).where(eq(imports.id, importId))
      return revision
    })
  }

  it('authorizes only the current completed generation while preserving owner, revision and rewrite gates', async () => {
    const connectorId = await source()
    const otherConnectorId = await source(owners[1])
    const alice = `u:${owners[0].aliceId}@fixture.test`
    const bobEmail = `${owners[0].bobId}@fixture.test`
    const bob = `u:${bobEmail}`
    await locked(connectorId, (tx) =>
      writeConnectorPermissions(tx, connectorId, {
        expectedRevision: 0,
        metadata,
        payload: {},
        groups: [{ groupKey: 'project:11', subjects: [alice] }],
      })
    )
    const pending = await createImport(connectorId, 1, {
      projectPermissions: { filename: 'permissions.csv', parts: 1, rowCount: 2 },
    })
    await append(connectorId, pending, {
      partNumber: 0,
      field: 'userMapping',
      content: `1,${bobEmail}\n`,
    })
    await append(connectorId, pending, {
      partNumber: 1,
      field: 'projectPermissions',
      content: 'engineering/allowed,1\nengineering/other,999\n',
    })
    expect(await hasConnectorPermissionGrant(connectorId, 'project:11', alice)).toBe(true)
    expect(await hasConnectorPermissionGrant(connectorId, 'project:11', bob)).toBe(false)

    const revision = await publish(connectorId, pending, 1)
    expect(await hasConnectorPermissionGrant(connectorId, 'project:11', alice)).toBe(false)
    expect(await hasConnectorPermissionGrant(connectorId, 'project:11', bob)).toBe(true)
    expect(await hasConnectorPermissionGrant(connectorId, 'project:12', bob)).toBe(false)
    expect(
      await readConnectorPermissionGrants(connectorId, revision - 1, ['project:11'], bob)
    ).toEqual(new Set())
    expect(
      await readConnectorPermissionGrants(connectorId, revision, ['project:11', 'project:12'], bob)
    ).toEqual(new Set(['project:11']))
    expect(await connectorsGrantingSubject([connectorId, otherConnectorId], bob)).toEqual(
      new Set([connectorId])
    )
    expect(
      await loadConnectorPermissionGroupTokens(bob, {
        kind: 'workspace',
        workspaceId: owners[0].workspaceId,
      })
    ).toEqual([connectorPermissionGroupToken(connectorId, 'project:11')])
    expect(
      await loadConnectorPermissionGroupTokens(bob, {
        kind: 'workspace',
        workspaceId: owners[1].workspaceId,
      })
    ).toEqual([])

    await db
      .update(knowledgeConnector)
      .set({ accessRewritePending: true })
      .where(eq(knowledgeConnector.id, connectorId))
    expect(
      await loadConnectorPermissionGroupTokens(bob, {
        kind: 'workspace',
        workspaceId: owners[0].workspaceId,
      })
    ).toEqual([])
    await db
      .update(knowledgeConnector)
      .set({ accessRewritePending: false })
      .where(eq(knowledgeConnector.id, connectorId))

    const replacement = await createImport(connectorId, revision)
    await append(connectorId, replacement, {
      partNumber: 0,
      field: 'userMapping',
      content: `1,${owners[0].aliceId}@fixture.test\n`,
    })
    await append(connectorId, replacement, {
      partNumber: 1,
      field: 'projectPermissions',
      content: 'engineering/other,1\n',
    })
    await publish(connectorId, replacement, revision)
    expect(await hasConnectorPermissionGrant(connectorId, 'project:11', bob)).toBe(false)
    expect(await hasConnectorPermissionGrant(connectorId, 'project:12', alice)).toBe(true)

    await locked(connectorId, (tx) =>
      writeConnectorPermissions(tx, connectorId, {
        expectedRevision: revision + 1,
        metadata,
        payload: {},
        groups: [{ groupKey: 'project:11', subjects: [bob] }],
      })
    )
    expect(await hasConnectorPermissionGrant(connectorId, 'project:12', alice)).toBe(false)
    expect(await hasConnectorPermissionGrant(connectorId, 'project:11', bob)).toBe(true)
  })

  it('preserves large permissions on settings saves and rejects partial or identity-changing replacements', async () => {
    const connectorId = await source()
    await locked(connectorId, (tx) =>
      writeConnectorPermissions(tx, connectorId, {
        expectedRevision: 0,
        metadata,
        payload: {},
        groups: [],
      })
    )
    const imported = await createImport(connectorId, 1)
    await append(connectorId, imported, {
      partNumber: 0,
      field: 'userMapping',
      content: '1,alice@fixture.test\n',
    })
    await append(connectorId, imported, {
      partNumber: 1,
      field: 'projectPermissions',
      content: 'engineering/allowed,1\n',
    })
    await publish(connectorId, imported, 1)
    const saved = await loadGitLabPermissionSnapshot(connectorId)
    expect(saved?.importId).toBe(imported)
    expect(saved?.userMappingRows).toBeNull()
    const prepared = prepareGitLabPermissions(
      { mode: 'csv', expectedRevision: 2 },
      metadata,
      saved,
      true
    )
    await locked(connectorId, (tx) =>
      writeConnectorPermissions(tx, connectorId, {
        ...gitLabPermissionData(prepared),
        expectedRevision: prepared.expectedRevision,
      })
    )
    expect(
      await readConnectorPermissionGrants(connectorId, 3, ['project:11'], 'u:alice@fixture.test')
    ).toEqual(new Set(['project:11']))
    expect(() =>
      prepareGitLabPermissions(
        {
          mode: 'csv',
          expectedRevision: 2,
          userMapping: { filename: 'users.csv', content: '1,bob@fixture.test\n' },
        },
        metadata,
        saved,
        true
      )
    ).toThrow('Replace both CSVs together')
    expect(() =>
      prepareGitLabPermissions(
        { mode: 'csv', expectedRevision: 2 },
        {
          ...metadata,
          projects: [{ id: 99, path: 'engineering/allowed' }],
        },
        saved,
        true
      )
    ).toThrow('A GitLab project identity changed')
    expect(
      await hasConnectorPermissionGrant(connectorId, 'project:11', 'u:alice@fixture.test')
    ).toBe(true)
  })

  it('rejects cross-part identity collisions and out-of-group rows without advancing the receipt', async () => {
    const connectorId = await source()
    const importId = await createImport(connectorId, 1, {
      userMapping: { filename: 'users.csv', parts: 2, rowCount: 3 },
      projectPermissions: { filename: 'permissions.csv', parts: 1, rowCount: 2 },
    })
    await append(connectorId, importId, {
      partNumber: 0,
      field: 'userMapping',
      content: '1,alice@fixture.test\n',
    })
    for (const content of [
      '2,alice@fixture.test\n3,carol@fixture.test\n',
      '1,bob@fixture.test\n3,carol@fixture.test\n',
    ]) {
      await expect(
        append(connectorId, importId, { partNumber: 1, field: 'userMapping', content })
      ).rejects.toMatchObject({ code: 'validation' })
    }
    expect(
      await db
        .select({ userId: identities.userId })
        .from(identities)
        .where(eq(identities.importId, importId))
    ).toEqual([{ userId: '1' }])
    expect(await loadPermissionImport(importId, connectorId)).toMatchObject({
      userRows: 1,
      projectRows: 0,
      partDigests: [expect.any(String)],
    })
    await append(connectorId, importId, {
      partNumber: 1,
      field: 'userMapping',
      content: '1,alice@fixture.test\n2,bob@fixture.test\n',
    })
    await expect(
      append(connectorId, importId, {
        partNumber: 2,
        field: 'projectPermissions',
        content: 'engineering/allowed,1\nelsewhere/private,2\n',
      })
    ).rejects.toMatchObject({ code: 'validation' })
    expect(
      await db.select({ userId: grants.userId }).from(grants).where(eq(grants.importId, importId))
    ).toEqual([])
    expect(await loadPermissionImport(importId, connectorId)).toMatchObject({
      userRows: 3,
      projectRows: 0,
      partDigests: [expect.any(String), expect.any(String)],
    })
    await append(connectorId, importId, {
      partNumber: 2,
      field: 'projectPermissions',
      content: 'engineering/allowed,1\nengineering/allowed,999\n',
    })
    const record = await loadPermissionImport(importId, connectorId)
    if (!record) throw new Error('Import fixture is missing')
    expect(await permissionImportSummaries(record)).toMatchObject({
      userMapping: { rowCount: 2 },
      projectPermissions: { rowCount: 2 },
    })
    expect(record.userRows).toBe(3)
  })

  it('rolls back a part and its receipt together when the enclosing transaction fails', async () => {
    const connectorId = await source()
    const importId = await createImport(connectorId, 1)
    const part = { partNumber: 0, field: 'userMapping' as const, content: '1,alice@fixture.test\n' }
    await expect(
      locked(connectorId, async (tx) => {
        const [record] = await tx
          .select()
          .from(imports)
          .where(eq(imports.id, importId))
          .for('update')
        if (!record) throw new Error('Import fixture is missing')
        await appendPermissionImportPart(tx, record, part)
        throw new Error('Fixture transaction failure after staging')
      })
    ).rejects.toThrow('Fixture transaction failure after staging')
    expect(
      await db
        .select({ userId: identities.userId })
        .from(identities)
        .where(eq(identities.importId, importId))
    ).toEqual([])
    expect(await loadPermissionImport(importId, connectorId)).toMatchObject({
      partDigests: [],
      userRows: 0,
      projectRows: 0,
      bytes: 0,
    })
    await expect(append(connectorId, importId, part)).resolves.toEqual({ nextPart: 1 })
  })

  it('revalidates canonical group and project identities before activating saved grants', async () => {
    const connectorId = await source()
    const importId = await createImport(connectorId, 1)
    await append(connectorId, importId, {
      partNumber: 0,
      field: 'userMapping',
      content: '1,alice@fixture.test\n',
    })
    await append(connectorId, importId, {
      partNumber: 1,
      field: 'projectPermissions',
      content: 'engineering/allowed,1\n',
    })
    const record = await loadPermissionImport(importId, connectorId)
    if (!record) throw new Error('Import fixture is missing')
    for (const scope of [
      { ...metadata, host: 'https://other.example.com' },
      { ...metadata, group: { ...metadata.group, id: 2 } },
      { ...metadata, projects: [{ id: 12, path: 'engineering/other' }] },
      { ...metadata, projects: [{ id: 99, path: 'engineering/allowed' }] },
    ]) {
      await expect(validatePermissionImportScope(record, scope)).rejects.toMatchObject({
        code: 'validation',
      })
    }
    await expect(
      validatePermissionImportScope(record, {
        ...metadata,
        projects: [...metadata.projects, { id: 13, path: 'engineering/new' }],
      })
    ).resolves.toBeUndefined()
  })
})
