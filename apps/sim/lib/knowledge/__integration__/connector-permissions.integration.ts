/** Real PostgreSQL coverage for provider-independent snapshots and administrator-managed grants. */
import { db } from '@sim/db'
import { knowledgeConnector, organization, user, workspace } from '@sim/db/schema'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { seedKnowledgeAclFixture } from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { loadConnectorPermissionGroupTokens } from '@/lib/knowledge/access/connector-permissions'
import {
  loadConnectorPermissionSnapshot,
  readConnectorPermissionMetadata,
  writeConnectorPermissions,
} from '@/lib/knowledge/connectors/permission-store'
import { connectorPermissionGroupToken } from '@/lib/knowledge/connectors/permission-tokens'

describe('connector-owned permission storage', () => {
  const owners: Awaited<ReturnType<typeof seedKnowledgeAclFixture>>[] = []
  beforeAll(async () => {
    owners.push(await seedKnowledgeAclFixture())
    owners.push(await seedKnowledgeAclFixture(undefined, { connectorType: 'google_drive' }))
  })
  afterAll(async () => {
    for (const owner of owners) {
      await db.delete(workspace).where(eq(workspace.id, owner.workspaceId))
      await db.delete(organization).where(eq(organization.id, owner.organizationId))
      await db.delete(user).where(inArray(user.id, [owner.aliceId, owner.bobId]))
    }
    await db.$client.end()
  })
  const save = (connectorId: string, input: Parameters<typeof writeConnectorPermissions>[2]) =>
    db.transaction(async (tx) => {
      await tx
        .select({ id: knowledgeConnector.id })
        .from(knowledgeConnector)
        .where(eq(knowledgeConnector.id, connectorId))
        .for('update')
      await writeConnectorPermissions(tx, connectorId, input)
    })

  it('isolates grants by connector and owner without knowing a provider payload format', async () => {
    const subject = `u:${owners[0].aliceId}@fixture.test`
    for (const owner of owners) {
      await save(owner.connectorId, {
        expectedRevision: 0,
        metadata: { format: 'fixture' },
        payload: { privateRows: ['fixture-private-payload'] },
        groups: [{ groupKey: 'readers', subjects: [subject] }],
      })
      expect(
        await loadConnectorPermissionGroupTokens(subject, {
          kind: 'workspace',
          workspaceId: owner.workspaceId,
        })
      ).toEqual([connectorPermissionGroupToken(owner.connectorId, 'readers')])
    }
    expect(await readConnectorPermissionMetadata([owners[0].connectorId])).toEqual([
      { connectorId: owners[0].connectorId, revision: 1, metadata: { format: 'fixture' } },
    ])
    expect((await loadConnectorPermissionSnapshot(owners[0].connectorId))?.payload).toEqual({
      privateRows: ['fixture-private-payload'],
    })
    await db
      .update(knowledgeConnector)
      .set({ accessRewritePending: true })
      .where(eq(knowledgeConnector.id, owners[0].connectorId))
    expect(
      await loadConnectorPermissionGroupTokens(subject, {
        kind: 'workspace',
        workspaceId: owners[0].workspaceId,
      })
    ).toEqual([])
    await db
      .update(knowledgeConnector)
      .set({ accessRewritePending: false })
      .where(eq(knowledgeConnector.id, owners[0].connectorId))
  })

  it('rolls back private writes and rejects stale revisions before a replacement can restore grants', async () => {
    const owner = owners[0]
    const before = await loadConnectorPermissionSnapshot(owner.connectorId)
    const update = {
      expectedRevision: 1,
      metadata: { format: 'updated' },
      payload: { privateRows: ['replacement-private-payload'] },
      groups: [{ groupKey: 'readers', subjects: ['invalid-private-subject'] }],
    }
    await expect(save(owner.connectorId, update)).rejects.toMatchObject({
      code: 'internal',
      message: 'Could not save permissions. The previous configuration was preserved.',
    })
    expect(await loadConnectorPermissionSnapshot(owner.connectorId)).toEqual(before)
    const replacements = await Promise.allSettled([
      save(owner.connectorId, { ...update, groups: [] }),
      save(owner.connectorId, { ...update, groups: [] }),
    ])
    expect(replacements.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(replacements.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { code: 'conflict' },
    })
    expect(
      await loadConnectorPermissionGroupTokens(`u:${owner.aliceId}@fixture.test`, {
        kind: 'workspace',
        workspaceId: owner.workspaceId,
      })
    ).toEqual([])
  })
})
