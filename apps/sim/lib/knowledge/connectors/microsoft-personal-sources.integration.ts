import { db } from '@sim/db'
import {
  account,
  credential,
  credentialGroup,
  credentialGroupEnrollment,
  member,
  organization,
  user,
  workspace,
} from '@sim/db/schema'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { generateId } from '@sim/utils/id'
import { eq, inArray, or } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { env } from '@/lib/core/config/env'
import { ensureWorkspaceAccountsGroup } from '@/lib/credential-groups/service'
import { listOrganizationOAuthCredentials } from '@/lib/credentials/application/organization-credentials'
import { provisionKnowledgeConnectorMembersBinding } from '@/lib/knowledge/connectors/member-provisioning'
import { onedriveConnectorMeta } from '@/connectors/onedrive/meta'

/** Real storage and authorization; CI writes the shared INTEGRATION_REPORT_PATH JSON artifact. */
describe('personal Microsoft sources', () => {
  let ownerId: string
  let otherId: string
  let organizationId: string
  let foreignOrganizationId: string
  let workspaceId: string

  beforeEach(async () => {
    Object.assign(env, {
      MICROSOFT_CLIENT_ID: 'existing-client',
      MICROSOFT_CLIENT_SECRET: 'existing-client-secret',
      MICROSOFT_PERSONAL_CLIENT_ID: 'personal-client',
      MICROSOFT_PERSONAL_CLIENT_SECRET: 'personal-client-secret',
    })
    ownerId = generateId()
    otherId = generateId()
    organizationId = generateId()
    foreignOrganizationId = generateId()
    workspaceId = generateId()
    await db.insert(user).values(
      [ownerId, otherId].map((id) => ({
        id,
        name: 'OAuth fixture',
        email: `${id}@fixture.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }))
    )
    await db.insert(organization).values(
      [organizationId, foreignOrganizationId].map((id) => ({
        id,
        name: 'OAuth fixture organization',
        slug: id,
      }))
    )
    await db.insert(member).values({
      id: generateId(),
      organizationId,
      userId: ownerId,
      role: 'owner',
    })
    await db.insert(workspace).values({
      id: workspaceId,
      name: 'OAuth fixture workspace',
      organizationId,
      ownerId,
      billedAccountUserId: ownerId,
    })
  })

  afterEach(async () => {
    await db
      .delete(credentialGroup)
      .where(
        or(
          eq(credentialGroup.workspaceId, workspaceId),
          inArray(credentialGroup.organizationId, [organizationId, foreignOrganizationId])
        )
      )
    await db.delete(workspace).where(eq(workspace.id, workspaceId))
    await db
      .delete(organization)
      .where(inArray(organization.id, [organizationId, foreignOrganizationId]))
    await db.delete(user).where(inArray(user.id, [ownerId, otherId]))
  })

  const provision = () =>
    provisionKnowledgeConnectorMembersBinding({
      workspaceId,
      userId: ownerId,
      connectorMeta: onedriveConnectorMeta,
    })

  it.each([false, true])(
    'keeps the existing personal source binding when the work app is configured: %s',
    async (workAppConfigured) => {
      const group = await ensureWorkspaceAccountsGroup(workspaceId, ownerId, {
        provider: 'onedrive-personal',
        label: 'OneDrive',
        required: false,
      })
      if (!workAppConfigured) {
        Object.assign(env, { MICROSOFT_CLIENT_ID: undefined, MICROSOFT_CLIENT_SECRET: undefined })
      }
      expect(await provision()).toEqual({
        credentialGroupId: group.id,
        credentialGroupOptionId: group.options[0].id,
      })
      const [stored] = await db
        .select()
        .from(credentialGroup)
        .where(eq(credentialGroup.id, group.id))
      expect(stored.options.map((option) => option.provider)).toEqual(['onedrive-personal'])
    }
  )

  it('provisions the personal provider when only that app is configured', async () => {
    Object.assign(env, { MICROSOFT_CLIENT_ID: undefined, MICROSOFT_CLIENT_SECRET: undefined })
    const binding = await provision()
    const [stored] = await db
      .select()
      .from(credentialGroup)
      .where(eq(credentialGroup.id, binding.credentialGroupId))
    expect(stored.options).toHaveLength(1)
    expect(stored.options[0]).toMatchObject({
      id: binding.credentialGroupOptionId,
      provider: 'onedrive-personal',
    })
  })

  it('refuses to guess between two active account types', async () => {
    await ensureWorkspaceAccountsGroup(workspaceId, ownerId, {
      provider: 'onedrive-personal',
      label: 'Personal OneDrive',
      required: false,
    })
    await ensureWorkspaceAccountsGroup(workspaceId, ownerId, {
      provider: 'onedrive',
      label: 'Work OneDrive',
      required: false,
    })
    await expect(provision()).rejects.toThrow('member sign-in')
  })

  async function addOAuth(providerId: string, createdBy = ownerId, orgId = organizationId) {
    const accountId = generateId()
    const credentialId = generateId()
    await db.insert(account).values({
      id: accountId,
      accountId,
      providerId,
      userId: createdBy,
      scope: 'openid Files.Read',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    await db.insert(credential).values({
      id: credentialId,
      organizationId: orgId,
      accountId,
      type: 'oauth',
      displayName: 'Fixture connection',
      providerId,
      createdBy,
    })
    return credentialId
  }

  const list = (providerId: string, purpose?: 'browsing') =>
    listOrganizationOAuthCredentials.execute({
      principal: createSessionPrincipal({ userId: ownerId }),
      input: { organizationId, providerId, purpose },
    })

  it('lists compatible personal grants without crossing user, organization or service boundaries', async () => {
    const workId = await addOAuth('onedrive')
    const personalId = await addOAuth('onedrive-personal')
    await addOAuth('onedrive-personal', otherId)
    await addOAuth('onedrive-personal', ownerId, foreignOrganizationId)
    await addOAuth('outlook-personal')
    expect((await list('onedrive')).credentials.map(({ id }) => id).sort()).toEqual(
      [workId, personalId].sort()
    )
    expect((await list('onedrive-personal')).credentials.map(({ id }) => id)).toEqual([personalId])
  })

  it('includes the caller’s live personal enrollment for browsing, without allowing indexing', async () => {
    const group = await ensureWorkspaceAccountsGroup(
      { kind: 'organization', organizationId },
      ownerId,
      { provider: 'onedrive-personal', label: 'Personal OneDrive', required: false }
    )
    const [stored] = await db.select().from(credentialGroup).where(eq(credentialGroup.id, group.id))
    const option = stored.options[0]
    const enrollmentId = generateId()
    const credentialId = generateId()
    await db.insert(credentialGroupEnrollment).values({
      id: enrollmentId,
      credentialGroupId: group.id,
      email: `${ownerId}@fixture.test`,
      userId: ownerId,
      status: 'completed',
      invitationTokenHash: 'a'.repeat(64),
      invitationExpiresAt: new Date(Date.now() + 60_000),
      invitedAt: new Date(),
    })
    await db.insert(credential).values({
      id: credentialId,
      organizationId,
      type: 'managed_oauth',
      displayName: 'Personal OneDrive',
      providerId: 'onedrive-personal',
      createdBy: ownerId,
      credentialGroupEnrollmentId: enrollmentId,
      credentialGroupOptionId: option.id,
      authorizationAppId: option.authorizationAppId,
      managedOauthScopeVersion: option.scopeVersion,
      providerSubjectId: 'fixture-subject',
      managedOauthStatus: 'active',
      grantedScopes: option.requiredScopes,
      encryptedOauthTokenSet: 'not-read-by-credential-lists',
      grantedAt: new Date(),
    })
    expect((await list('onedrive', 'browsing')).credentials.map(({ id }) => id)).toEqual([
      credentialId,
    ])
    expect((await list('onedrive')).credentials).toEqual([])
    await db
      .update(credentialGroupEnrollment)
      .set({ status: 'revoked' })
      .where(eq(credentialGroupEnrollment.id, enrollmentId))
    expect((await list('onedrive', 'browsing')).credentials).toEqual([])
  })
})
