import { createHash } from 'node:crypto'
import { db } from '@sim/db'
import {
  credential,
  credentialGroup,
  credentialGroupEnrollment,
  knowledgeConnector,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { eq, sql } from 'drizzle-orm'
import { encryptSecret } from '@/lib/core/security/encryption'
import { getCredentialGroupProviderAdapterByProviderId } from '@/lib/credential-groups/provider-registry'
import { encryptManagedOAuthTokenSet } from '@/lib/credentials/managed-oauth'
import type { createKnowledgeAclFixtureIds } from '@/lib/knowledge/__integration__/seed-source-access-fixture'

/** Converts the existing synthetic corpus to a central crawl with a real managed reader. */
export async function seedSearchReaderFixture(
  ids: ReturnType<typeof createKnowledgeAclFixtureIds>
) {
  const policy = await getCredentialGroupProviderAdapterByProviderId('confluence').getPolicy(
    undefined,
    {
      workspaceId: ids.workspaceId,
    }
  )
  const groupId = generateId()
  const optionId = generateId()
  const crawlerId = generateId()
  const enrollmentId = generateId()
  await db.insert(credentialGroup).values({
    id: groupId,
    workspaceId: ids.workspaceId,
    publicId: generateId(),
    name: 'Search benchmark readers',
    options: [
      {
        id: optionId,
        provider: 'confluence',
        label: 'Confluence fixture',
        required: false,
        status: 'active',
        authorizationAppId: policy.authorizationAppId,
        requiredScopes: policy.requiredScopes,
        scopeVersion: policy.scopeVersion,
      },
    ],
  })
  await db.insert(credential).values({
    id: crawlerId,
    workspaceId: ids.workspaceId,
    type: 'service_account',
    providerId: 'atlassian-service-account',
    displayName: 'Synthetic crawler',
    createdBy: ids.aliceId,
    encryptedServiceAccountKey: (
      await encryptSecret(
        JSON.stringify({
          type: 'atlassian_service_account',
          cloudId: 'search-fixture',
          domain: 'search-fixture.atlassian.net',
          apiToken: 'fixture-crawler-never-used-for-reading',
        })
      )
    ).encrypted,
  })
  await db.insert(credentialGroupEnrollment).values({
    id: enrollmentId,
    credentialGroupId: groupId,
    userId: ids.aliceId,
    email: `${ids.aliceId}@fixture.test`,
    status: 'completed',
    invitationTokenHash: createHash('sha256').update(generateId()).digest('hex'),
    invitationExpiresAt: new Date(Date.now() + 3600000),
    invitedAt: new Date(),
  })
  await db.insert(credential).values({
    id: generateId(),
    workspaceId: ids.workspaceId,
    type: 'managed_oauth',
    displayName: 'Synthetic search reader',
    createdBy: ids.aliceId,
    providerId: 'confluence',
    providerSubjectId: ids.aliceId,
    authorizationAppId: policy.authorizationAppId,
    credentialGroupEnrollmentId: enrollmentId,
    credentialGroupOptionId: optionId,
    managedOauthScopeVersion: policy.scopeVersion,
    managedOauthStatus: 'active',
    grantedScopes: policy.requiredScopes,
    grantedAt: new Date(),
    encryptedOauthTokenSet: await encryptManagedOAuthTokenSet({
      accessToken: 'fixture-search-reader',
    }),
    accessTokenExpiresAt: new Date(Date.now() + 3600000),
  })
  await db
    .update(knowledgeConnector)
    .set({
      connectorType: 'confluence',
      credentialId: crawlerId,
      sourceConfig: { domain: 'search-fixture.atlassian.net' },
    })
    .where(eq(knowledgeConnector.id, ids.connectorId))
  await db.execute(sql`UPDATE document SET acl = ARRAY[${`s:confluence:-:${ids.aliceId}`}],
    acl_verified_at = statement_timestamp() WHERE knowledge_base_id = ${ids.knowledgeBaseId}`)
  await db.execute(sql`ANALYZE document`)
}
