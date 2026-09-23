/** Real PostgreSQL coverage for the probe that keeps a user's visible documents from being skipped. */
import { db } from '@sim/db'
import { document, knowledgeConnector, organization, user, workspace } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { seedKnowledgeAclFixture } from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { hasVisibleUserDocuments } from '@/lib/knowledge/connectors/user-document-visibility'

const DAY_MS = 24 * 60 * 60 * 1000

describe('Visible user documents in PostgreSQL', () => {
  let owner: Awaited<ReturnType<typeof seedKnowledgeAclFixture>>
  let otherConnectorId: string
  const email = () => `${owner.aliceId}@fixture.test`

  beforeEach(async () => {
    owner = await seedKnowledgeAclFixture(undefined, { connectorType: 'google_drive' })
    otherConnectorId = generateId()
    await db.insert(knowledgeConnector).values({
      id: otherConnectorId,
      knowledgeBaseId: owner.knowledgeBaseId,
      connectorType: 'google_drive',
      sourceConfig: {},
      accessMode: 'admin',
      status: 'active',
      credentialId: owner.credentialId,
    })
  })
  afterEach(async () => {
    await db.delete(workspace).where(eq(workspace.id, owner.workspaceId))
    await db.delete(organization).where(eq(organization.id, owner.organizationId))
    await db.delete(user).where(inArray(user.id, [owner.aliceId, owner.bobId]))
  })
  afterAll(() => db.$client.end())

  const insert = (overrides: Partial<typeof document.$inferInsert> = {}) =>
    db.insert(document).values({
      id: generateId(),
      knowledgeBaseId: owner.knowledgeBaseId,
      connectorId: owner.connectorId,
      externalId: generateId(),
      filename: 'Event.txt',
      mimeType: 'text/plain',
      fileUrl: '',
      fileSize: 0,
      acl: [`u:${email()}`],
      aclVerifiedAt: new Date(),
      ...overrides,
    })

  it('finds a live, included document granted to the user with fresh permission evidence', async () => {
    await insert()
    expect(await hasVisibleUserDocuments(owner.connectorId, email())).toBe(true)
  })

  it('matches a mixed-case, padded directory email to the normalized ACL token', async () => {
    await insert()
    expect(await hasVisibleUserDocuments(owner.connectorId, `  ${email().toUpperCase()} `)).toBe(
      true
    )
  })

  it.each([
    {
      label: 'permission evidence older than the freshness limit',
      overrides: () => ({ aclVerifiedAt: new Date(Date.now() - DAY_MS - 60_000) }),
    },
    { label: 'no permission evidence', overrides: () => ({ aclVerifiedAt: null }) },
    {
      label: 'a grant to a different user',
      overrides: () => ({ acl: [`u:${owner.bobId}@fixture.test`] }),
    },
    {
      label: 'a document in another connector',
      overrides: () => ({ connectorId: otherConnectorId }),
    },
    { label: 'a user-excluded document', overrides: () => ({ userExcluded: true }) },
    { label: 'an archived document', overrides: () => ({ archivedAt: new Date() }) },
    { label: 'a deleted document', overrides: () => ({ deletedAt: new Date() }) },
  ])('ignores $label', async ({ overrides }) => {
    await insert(overrides())
    expect(await hasVisibleUserDocuments(owner.connectorId, email())).toBe(false)
  })

  it('refuses an address that cannot be a user token', async () => {
    await insert()
    expect(await hasVisibleUserDocuments(owner.connectorId, '   ')).toBe(false)
  })
})
