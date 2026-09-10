/** Real source identity, directory persistence and protected reads; only the provider response is fixed. */
import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import {
  credential,
  credentialGroup,
  document,
  knowledgeConnector,
  user,
  workspace,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { env } from '@/lib/core/config/env'
import { encryptSecret } from '@/lib/core/security/encryption'
import { getCredentialGroupProviderAdapterByProviderId } from '@/lib/credential-groups/provider-registry'
import { encryptManagedOAuthTokenSet } from '@/lib/credentials/managed-oauth'
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
  const previousConfluenceClient = {
    CONFLUENCE_CLIENT_ID: env.CONFLUENCE_CLIENT_ID,
    CONFLUENCE_CLIENT_SECRET: env.CONFLUENCE_CLIENT_SECRET,
  }
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
    Object.assign(env, {
      CONFLUENCE_CLIENT_ID: 'isolated-confluence-fixture-client',
      CONFLUENCE_CLIENT_SECRET: 'isolated-confluence-fixture-secret',
    })
    vi.stubGlobal('fetch', async (url: string, options?: RequestInit) => {
      if (
        url ===
          'https://api.atlassian.com/ex/confluence/fixture-cloud/wiki/rest/api/user/current' &&
        new Headers(options?.headers).get('Authorization') === 'Bearer fixture-confluence-reader'
      )
        return Response.json({ type: 'known', accountId })
      throw new Error('Unexpected outbound Confluence identity fixture request')
    })
    await seedKnowledgeAclFixture(ids)
    const managed = await seedKnowledgeMemberFixture(ids)
    member = managed.members[0]
    const policy = await getCredentialGroupProviderAdapterByProviderId('confluence').getPolicy(
      undefined,
      { workspaceId: ids.workspaceId }
    )
    const [accounts] = await db
      .select()
      .from(credentialGroup)
      .where(eq(credentialGroup.id, managed.groupId))
    await db
      .update(credentialGroup)
      .set({
        options: accounts.options.map((option) => ({
          ...option,
          provider: 'confluence',
          authorizationAppId: policy.authorizationAppId,
          requiredScopes: policy.requiredScopes,
          scopeVersion: policy.scopeVersion,
        })),
      })
      .where(eq(credentialGroup.id, managed.groupId))
    await db
      .update(credential)
      .set({
        providerId: 'confluence',
        providerTenantId: null,
        providerSubjectId: accountId,
        authorizationAppId: policy.authorizationAppId,
        managedOauthScopeVersion: policy.scopeVersion,
        grantedScopes: policy.requiredScopes,
        encryptedOauthTokenSet: await encryptManagedOAuthTokenSet({
          accessToken: 'fixture-confluence-reader',
        }),
        accessTokenExpiresAt: new Date(Date.now() + 3600000),
      })
      .where(eq(credential.id, member.credentialId))
    const crawlerId = generateId()
    await db.insert(credential).values({
      id: crawlerId,
      workspaceId: ids.workspaceId,
      type: 'service_account',
      providerId: 'atlassian-service-account',
      displayName: 'Confluence crawler fixture',
      createdBy: ids.aliceId,
      encryptedServiceAccountKey: (
        await encryptSecret(
          JSON.stringify({
            type: 'atlassian_service_account',
            cloudId: 'fixture-cloud',
            domain: 'fixture.atlassian.net',
            apiToken: 'fixture-crawler-never-used-for-reading',
          })
        )
      ).encrypted,
    })
    await db
      .update(knowledgeConnector)
      .set({ credentialId: crawlerId, sourceConfig: { domain: 'fixture.atlassian.net' } })
      .where(eq(knowledgeConnector.id, ids.connectorId))
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
    vi.unstubAllGlobals()
    Object.assign(env, previousConfluenceClient)
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
