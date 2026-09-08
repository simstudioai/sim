/** Real source identity, directory persistence and protected document reads; no provider calls. */
import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { credential, credentialGroup, document, user, workspace } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
  seedKnowledgeMemberFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { groupToken, subjectToken } from '@/lib/knowledge/access/tokens'
import { readKnowledgeDocument } from '@/lib/knowledge/application/documents'
import { syncExternalDirectoryGroups } from '@/lib/knowledge/connectors/external-group-sync'

describe('Confluence identities with hidden directory email', () => {
  const ids = createKnowledgeAclFixtureIds()
  const accountId = 'Opaque:CaseSensitiveAccount'
  const sourceSubject = subjectToken({
    providerId: 'confluence',
    providerTenantId: null,
    providerSubjectId: accountId,
  })
  const group = groupToken({
    providerId: 'confluence',
    tenantId: 'fixture-cloud',
    groupId: 'private-space',
  })!
  const documents = [
    { id: generateId(), acl: [group] },
    { id: generateId(), acl: [sourceSubject] },
  ]
  const principal: Principal = {
    kind: 'session',
    userId: ids.aliceId,
    sessionId: 'fixture-confluence',
  }
  let member: Awaited<ReturnType<typeof seedKnowledgeMemberFixture>>['members'][number]

  beforeAll(async () => {
    await seedKnowledgeAclFixture(ids)
    const managed = await seedKnowledgeMemberFixture(ids)
    member = managed.members[0]
    const [accounts] = await db
      .select()
      .from(credentialGroup)
      .where(eq(credentialGroup.id, managed.groupId))
    await db
      .update(credentialGroup)
      .set({ options: accounts.options.map((option) => ({ ...option, provider: 'confluence' })) })
      .where(eq(credentialGroup.id, managed.groupId))
    await db
      .update(credential)
      .set({ providerId: 'confluence', providerTenantId: null, providerSubjectId: accountId })
      .where(eq(credential.id, member.credentialId))
    await syncExternalDirectoryGroups({
      workspaceId: ids.workspaceId,
      force: true,
      directory: {
        providerId: 'confluence',
        tenantId: 'fixture-cloud',
        listGroups: async () => [{ id: 'private-space' }],
        listGroupMembers: async (sourceGroup) => ({
          group: sourceGroup,
          memberTokens: [sourceSubject],
          complete: true,
        }),
      },
    })
    await db.insert(document).values(
      documents.map((fixture) => ({
        id: fixture.id,
        acl: fixture.acl,
        knowledgeBaseId: ids.knowledgeBaseId,
        filename: 'Hidden-email identity fixture',
        fileUrl: `https://fixture.invalid/${fixture.id}`,
        fileSize: 0,
        mimeType: 'text/plain',
        connectorId: ids.connectorId,
        processingStatus: 'completed',
        aclVerifiedAt: new Date(),
      }))
    )
  })

  afterAll(async () => {
    await db.delete(workspace).where(eq(workspace.id, ids.workspaceId))
    await db.delete(user).where(eq(user.id, ids.aliceId))
    await db.delete(user).where(eq(user.id, ids.bobId))
    await db.$client.end()
  })

  async function expectAccess(allowed: boolean) {
    for (const fixture of documents) {
      const read = readKnowledgeDocument.execute({
        principal,
        input: { knowledgeBaseId: ids.knowledgeBaseId, documentId: fixture.id },
      })
      if (allowed) await expect(read).resolves.toMatchObject({ document: { id: fixture.id } })
      else await expect(read).rejects.toThrow('Document not found')
    }
  }

  it('grants both cloud-group and direct-page access from the actual global Confluence identity', async () => {
    await expectAccess(true)
  })

  it('does not substitute a Jira account or a case-folded opaque subject', async () => {
    await db
      .update(credential)
      .set({ providerId: 'jira' })
      .where(eq(credential.id, member.credentialId))
    await expectAccess(false)
    await db
      .update(credential)
      .set({ providerId: 'confluence', providerSubjectId: accountId.toLowerCase() })
      .where(eq(credential.id, member.credentialId))
    await expectAccess(false)
    await db
      .update(credential)
      .set({ providerSubjectId: accountId })
      .where(eq(credential.id, member.credentialId))
    await expectAccess(true)
  })

  it('does not grant the same verified email access after the provider credential is revoked or removed', async () => {
    await db
      .update(credential)
      .set({ managedOauthStatus: 'revoked' })
      .where(eq(credential.id, member.credentialId))
    await expectAccess(false)
    await db
      .update(credential)
      .set({ managedOauthStatus: 'active' })
      .where(eq(credential.id, member.credentialId))
    await expectAccess(true)
    await db.delete(credential).where(eq(credential.id, member.credentialId))
    await expectAccess(false)
  })
})
