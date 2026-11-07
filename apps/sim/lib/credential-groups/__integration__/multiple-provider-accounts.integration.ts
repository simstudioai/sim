/**
 * One member connecting several accounts of one provider, against real Postgres so the unique
 * index and the serialized grant persistence are exercised, not a mock of them. Only the provider
 * exchange is faked: the authorization code names the identity the provider would have verified.
 */
import { db } from '@sim/db'
import {
  credential,
  credentialGroup,
  credentialGroupEnrollment,
  mcpServers,
  member,
  organization,
  user,
} from '@sim/db/schema'
import { sha256Hex } from '@sim/security/hash'
import { generateId } from '@sim/utils/id'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CredentialGroupOAuthContext } from '@/lib/credential-groups/enrollments'
import { listCredentialGroupEnrollments } from '@/lib/credential-groups/enrollments'
import { identifyStoredManagedMcpConnections } from '@/lib/credential-groups/mcp-oauth'
import { completeCredentialGroupOAuth } from '@/lib/credential-groups/oauth'
import type { CredentialGroupOAuthAttempt } from '@/lib/credential-groups/oauth-state'
import { CredentialGroupOAuthError } from '@/lib/credential-groups/provider-adapter'
import type { CredentialGroupProvider } from '@/lib/credential-groups/providers'
import { listViewerOrganizationAccounts } from '@/lib/credential-groups/viewer-accounts'
import { persistManagedMcpCredential } from '@/lib/credentials/managed-mcp'
import { decryptManagedOAuthTokenSet } from '@/lib/credentials/managed-oauth'
import { resolveSlackSearchMember } from '@/lib/knowledge/application/slack-search/identity'
import { mcpService } from '@/lib/mcp/service'

const POLICY = {
  authorizationAppId: 'fixture-app',
  requiredScopes: ['read'],
  scopeVersion: 1,
}

vi.mock('@/lib/credential-groups/scoped-availability', () => ({
  isScopedCredentialGroupsAvailable: async () => true,
}))

/** Each grant carries its own token, as a real exchange does, so a saved grant is identifiable. */
let grants = 0
/** Sites the next grant reports, or `undefined` when its site listing failed. */
let grantSites: Array<{ name: string; url: string }> | undefined

vi.mock('@/lib/credential-groups/provider-registry', async (importOriginal) => {
  const { getCredentialGroupProviderId } = await import('@/lib/credential-groups/providers')
  return {
    ...(await importOriginal<typeof import('@/lib/credential-groups/provider-registry')>()),
    getCredentialGroupProviderAdapter: (provider: CredentialGroupProvider) => {
      const policy = {
        ...POLICY,
        provider,
        providerId: getCredentialGroupProviderId(provider),
      }
      return {
        provider,
        requiresRefreshToken: false,
        getPolicy: async () => policy,
        exchangeAndVerify: async ({ code }: { code: string }) => {
          const [subject, tenant] = code.split('@')
          return {
            providerId: policy.providerId,
            providerSubjectId: subject,
            providerTenantId: tenant || null,
            displayName: code,
            metadata: { email: code, ...(grantSites ? { sites: grantSites } : {}) },
            accessToken: `token-for-${code}-${(grants += 1)}`,
            grantedScopes: POLICY.requiredScopes,
            accessTokenExpiresAt: null,
            refreshTokenExpiresAt: null,
          }
        },
      }
    },
  }
})

const organizationId = generateId()
const userId = generateId()
const groupId = generateId()
const enrollmentId = generateId()
let invitationToken = generateId()
const mcpServerId = generateId()
const email = `${userId}@example.test`

const optionFor = (provider: CredentialGroupProvider) => ({
  id: `option-${provider}`,
  provider,
  label: provider,
  authorizationAppId: POLICY.authorizationAppId,
  requiredScopes: POLICY.requiredScopes,
  scopeVersion: POLICY.scopeVersion,
  required: false,
  status: 'active' as const,
})
const DRIVE = optionFor('google-drive')
const GITHUB = optionFor('github-repositories')
const SLACK = optionFor('slack')
const CONFLUENCE = optionFor('confluence')
const NOTION = optionFor('notion')

function connect(
  code: string,
  connectionIntent?: CredentialGroupOAuthAttempt['connectionIntent'],
  option = DRIVE
) {
  const context: CredentialGroupOAuthContext = {
    enrollmentId,
    credentialGroupId: groupId,
    credentialGroupName: 'Connected accounts',
    organizationId,
    workspaceName: 'Fixture',
    workspaceOwnerId: null,
    credentialOwnerId: userId,
    email,
    enrollmentStatus: 'completed',
    option,
    options: [DRIVE, GITHUB, SLACK, CONFLUENCE, NOTION],
  }
  const attempt: CredentialGroupOAuthAttempt = {
    userId,
    state: generateId(),
    provider: option.provider as CredentialGroupProvider,
    nonceHash: 'nonce',
    organizationId,
    email,
    enrollmentId,
    credentialGroupId: groupId,
    optionId: option.id,
    authorizationAppId: POLICY.authorizationAppId,
    scopeVersion: POLICY.scopeVersion,
    requiredScopes: POLICY.requiredScopes,
    redirectUri: 'https://sim.test/callback',
    invitationToken,
    createdAt: Date.now(),
    ...(connectionIntent ? { connectionIntent } : {}),
  }
  return completeCredentialGroupOAuth(context, attempt, code)
}

async function failureOf(result: Promise<unknown>) {
  const error = await result.then(
    () => null,
    (caught: unknown) => caught
  )
  expect(error).toBeInstanceOf(CredentialGroupOAuthError)
  return (error as CredentialGroupOAuthError).failure
}

const rows = () =>
  db
    .select({
      id: credential.id,
      subject: credential.providerSubjectId,
      tenant: credential.providerTenantId,
      status: credential.managedOauthStatus,
      revokedAt: credential.revokedAt,
      tokens: credential.encryptedOauthTokenSet,
    })
    .from(credential)
    .where(eq(credential.organizationId, organizationId))

/** Mirrors the disconnect operation, which also invalidates the outstanding invitation token. */
async function disconnect(id: string) {
  await db
    .update(credential)
    .set({ managedOauthStatus: 'revoked', revokedAt: new Date() })
    .where(eq(credential.id, id))
  invitationToken = generateId()
  await db
    .update(credentialGroupEnrollment)
    .set({ invitationTokenHash: sha256Hex(invitationToken) })
    .where(eq(credentialGroupEnrollment.id, enrollmentId))
}

beforeAll(async () => {
  await db.insert(user).values({
    id: userId,
    name: 'Multiple accounts fixture',
    email,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  await db.insert(organization).values({
    id: organizationId,
    name: 'Multiple accounts fixture',
    slug: organizationId,
    createdAt: new Date(),
  })
  await db.insert(credentialGroup).values({
    id: groupId,
    organizationId,
    publicId: generateId(),
    name: 'Connected accounts',
    options: [DRIVE, GITHUB, SLACK, CONFLUENCE, NOTION],
  })
  await db.insert(member).values({
    id: generateId(),
    organizationId,
    userId,
    role: 'member',
    createdAt: new Date(),
  })
  await db.insert(mcpServers).values({
    id: mcpServerId,
    organizationId,
    credentialGroupId: groupId,
    managedConnectorId: 'notion',
    name: 'Notion',
    transport: 'streamable-http',
    url: 'https://mcp.notion.com/mcp',
    authType: 'oauth',
    oauthConfigVersion: 1,
    enabled: true,
    createdBy: userId,
  })
  await db.insert(credentialGroupEnrollment).values({
    id: enrollmentId,
    credentialGroupId: groupId,
    userId,
    email,
    status: 'completed',
    invitationTokenHash: sha256Hex(invitationToken),
    invitationExpiresAt: new Date(Date.now() + 3_600_000),
    invitedAt: new Date(),
    createdBy: userId,
  })
})

beforeEach(async () => {
  grantSites = undefined
  await db.delete(credential).where(eq(credential.organizationId, organizationId))
})

afterAll(async () => {
  await db.delete(organization).where(eq(organization.id, organizationId))
  await db.delete(user).where(eq(user.id, userId))
})

describe('connecting several accounts of one provider', () => {
  it('adds a second identity as its own credential and leaves the first untouched', async () => {
    const first = await connect('work@first-tenant.test', { kind: 'create' })
    const [before] = await rows()

    const second = await connect('work@second-tenant.test', { kind: 'create' })

    expect(second.created).toBe(true)
    expect(second.credentialId).not.toBe(first.credentialId)
    const after = await rows()
    expect(after).toHaveLength(2)
    expect(after.find((row) => row.id === first.credentialId)?.tokens).toBe(before?.tokens)
    const stored = after.find((row) => row.id === second.credentialId)
    expect(stored).toMatchObject({
      subject: 'work',
      tenant: 'second-tenant.test',
      status: 'active',
    })
    expect(await decryptManagedOAuthTokenSet(stored?.tokens ?? '')).toMatchObject({
      accessToken: expect.stringMatching(/^token-for-work@second-tenant\.test-/),
    })
  })

  it('treats one subject in two tenants as two accounts', async () => {
    await connect('same@tenant-a.test', { kind: 'create' })
    await connect('same@tenant-b.test', { kind: 'create' })
    expect(await rows()).toHaveLength(2)
  })

  it('refuses to add an identity that is already connected, changing nothing', async () => {
    await connect('work@first-tenant.test', { kind: 'create' })
    const before = await rows()

    expect(await failureOf(connect('work@first-tenant.test', { kind: 'create' }))).toBe(
      'account_already_connected'
    )
    expect(await rows()).toEqual(before)
  })

  it('stops adding at the per-provider limit, without counting disconnected accounts', async () => {
    const created = []
    for (let index = 0; index < 5; index += 1)
      created.push(await connect(`user-${index}@tenant.test`, { kind: 'create' }))

    expect(await failureOf(connect('user-5@tenant.test', { kind: 'create' }))).toBe(
      'account_limit_reached'
    )
    expect(await rows()).toHaveLength(5)

    await disconnect(created[0]?.credentialId ?? '')
    await connect('user-5@tenant.test', { kind: 'create' })
    expect(await rows()).toHaveLength(6)
  })

  it('never creates two rows when the same identity completes twice at once', async () => {
    const results = await Promise.allSettled([
      connect('work@first-tenant.test', { kind: 'create' }),
      connect('work@first-tenant.test', { kind: 'create' }),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(await rows()).toHaveLength(1)
  })
})

describe('reconnecting one of several accounts', () => {
  it('refreshes only the targeted credential', async () => {
    const first = await connect('work@first-tenant.test', { kind: 'create' })
    const second = await connect('work@second-tenant.test', { kind: 'create' })
    const before = await rows()

    const reconnected = await connect('work@second-tenant.test', {
      kind: 'reconnect',
      credentialId: second.credentialId,
    })

    expect(reconnected).toMatchObject({ created: false, credentialId: second.credentialId })
    const after = await rows()
    const untouched = (list: typeof after) => list.find((row) => row.id === first.credentialId)
    expect(untouched(after)?.tokens).toBe(untouched(before)?.tokens)
    const targeted = (list: typeof after) => list.find((row) => row.id === second.credentialId)
    expect(targeted(after)?.tokens).not.toBe(targeted(before)?.tokens)
    expect(after).toHaveLength(2)
  })

  it('refuses a different identity, including another connected account of the member', async () => {
    const first = await connect('work@first-tenant.test', { kind: 'create' })
    await connect('work@second-tenant.test', { kind: 'create' })
    const before = await rows()

    const intent = { kind: 'reconnect', credentialId: first.credentialId } as const
    expect(await failureOf(connect('work@second-tenant.test', intent))).toBe('account_mismatch')
    expect(await failureOf(connect('stranger@other.test', intent))).toBe('account_mismatch')
    expect(await rows()).toEqual(before)
  })

  it('refuses a reconnect target that belongs to another option', async () => {
    await connect('work@first-tenant.test', { kind: 'create' })
    const other = await connect('work@first-tenant.test', { kind: 'create' }, GITHUB)
    await expect(
      connect('work@first-tenant.test', { kind: 'reconnect', credentialId: other.credentialId })
    ).rejects.toThrow('account changed')
    expect(await rows()).toHaveLength(2)
  })
})

describe('adding another site to an Atlassian login', () => {
  it('keeps the new grant on the existing account instead of refusing it', async () => {
    const first = await connect('person@atlassian', { kind: 'create' }, CONFLUENCE)
    const saved = async () =>
      (await decryptManagedOAuthTokenSet((await rows())[0]?.tokens ?? '')).accessToken
    const firstToken = await saved()

    const added = await connect('person@atlassian', { kind: 'create' }, CONFLUENCE)

    expect(added).toMatchObject({ created: false, credentialId: first.credentialId })
    expect(await rows()).toHaveLength(1)
    expect(await saved()).toMatch(/^token-for-person@atlassian-/)
    expect(await saved()).not.toBe(firstToken)
  })

  it('shows the sites recorded for the account, ignoring anything unusable', async () => {
    const account = await connect('person@atlassian', { kind: 'create' }, CONFLUENCE)
    const viewer = async () =>
      (await listViewerOrganizationAccounts({ organizationId, userId })).find(
        (row) => row.credentialId === account.credentialId
      )
    expect((await viewer())?.sites).toEqual([])

    await db
      .update(credential)
      .set({
        providerMetadata: sql`${JSON.stringify({
          email: 'person@atlassian',
          sites: [
            { name: 'Acme', url: 'https://acme.example.net' },
            { name: 42, url: 'https://broken.example.net' },
            'not a site',
          ],
        })}::jsonb`,
      })
      .where(eq(credential.id, account.credentialId))

    expect((await viewer())?.sites).toEqual([{ name: 'Acme', url: 'https://acme.example.net' }])
  })

  it('never lets oversized stored sites break the account list', async () => {
    const account = await connect('person@atlassian', { kind: 'create' }, CONFLUENCE)
    const site = (index: number) => ({
      name: `Site ${index}`,
      url: `https://s${index}.example.net`,
    })
    await db
      .update(credential)
      .set({
        providerMetadata: sql`${JSON.stringify({
          email: 'person@atlassian',
          sites: [
            { name: 'x'.repeat(600), url: 'https://long-name.example.net' },
            { name: 'Long URL', url: `https://example.net/${'x'.repeat(2100)}` },
            ...Array.from({ length: 60 }, (_, index) => site(index)),
          ],
        })}::jsonb`,
      })
      .where(eq(credential.id, account.credentialId))

    const [viewer] = await listViewerOrganizationAccounts({ organizationId, userId })
    expect(viewer?.sites).toHaveLength(50)
    expect(viewer?.sites[0]).toEqual(site(0))
  })

  it('keeps the recorded sites when a reconnect cannot list them', async () => {
    grantSites = [{ name: 'Acme', url: 'https://acme.example.net' }]
    const account = await connect('person@atlassian', { kind: 'create' }, CONFLUENCE)
    const reconnect = () =>
      connect(
        'person@atlassian',
        { kind: 'reconnect', credentialId: account.credentialId },
        CONFLUENCE
      )
    const sites = async () =>
      (await listViewerOrganizationAccounts({ organizationId, userId }))[0]?.sites

    grantSites = undefined
    await reconnect()
    expect(await sites()).toEqual([{ name: 'Acme', url: 'https://acme.example.net' }])

    grantSites = []
    await reconnect()
    expect(await sites()).toEqual([])
  })

  it('still adds a different Atlassian login as its own account', async () => {
    await connect('person@atlassian', { kind: 'create' }, CONFLUENCE)
    await connect('other@atlassian', { kind: 'create' }, CONFLUENCE)
    expect(await rows()).toHaveLength(2)
  })
})

describe('an account recorded before its tenant was known', () => {
  it('stays separate on a provider that always recorded its tenant', async () => {
    const legacy = await connect('person', { kind: 'create' })
    expect(
      await failureOf(
        connect('person@workspace-a', { kind: 'reconnect', credentialId: legacy.credentialId })
      )
    ).toBe('account_mismatch')
  })

  it('takes on its tenant when reconnected or refreshed', async () => {
    const legacy = await connect('person', { kind: 'create' }, NOTION)

    await expect(
      connect(
        'person@workspace-a',
        { kind: 'reconnect', credentialId: legacy.credentialId },
        NOTION
      )
    ).resolves.toMatchObject({ created: false, credentialId: legacy.credentialId })
    expect(await rows()).toMatchObject([{ subject: 'person', tenant: 'workspace-a' }])
  })

  it('takes on its tenant through an invitation link', async () => {
    const legacy = await connect('person', { kind: 'create' }, NOTION)
    await expect(connect('person@workspace-a', undefined, NOTION)).resolves.toMatchObject({
      credentialId: legacy.credentialId,
    })
    expect(await rows()).toMatchObject([{ tenant: 'workspace-a' }])
  })

  it('must be reconnected before another tenant of the same login is added, so it is never overwritten', async () => {
    const legacy = await connect('person', { kind: 'create' }, NOTION)
    const [before] = await rows()

    expect(await failureOf(connect('person@workspace-b', { kind: 'create' }, NOTION))).toBe(
      'account_identity_required'
    )
    expect(await rows()).toEqual([before])

    await connect(
      'person@workspace-a',
      { kind: 'reconnect', credentialId: legacy.credentialId },
      NOTION
    )
    await connect('person@workspace-b', { kind: 'create' }, NOTION)
    expect((await rows()).map((row) => row.tenant).sort()).toEqual(['workspace-a', 'workspace-b'])
  })
})

describe('adding an account that needs reconnecting', () => {
  it('refreshes it instead of calling it already connected', async () => {
    const first = await connect('work@first-tenant.test', { kind: 'create' })
    await db
      .update(credential)
      .set({ managedOauthStatus: 'needs_reauth' })
      .where(eq(credential.id, first.credentialId))

    const refreshed = await connect('work@first-tenant.test', { kind: 'create' })

    expect(refreshed).toMatchObject({ created: false, credentialId: first.credentialId })
    expect(await rows()).toMatchObject([{ status: 'active' }])
  })
})

describe('after disconnecting', () => {
  it('does not let reconnecting a disconnected account exceed the limit', async () => {
    const created = []
    for (let index = 0; index < 5; index += 1)
      created.push(await connect(`user-${index}@tenant.test`, { kind: 'create' }))
    const disconnected = created[0]?.credentialId ?? ''
    await disconnect(disconnected)
    await connect('replacement@tenant.test', { kind: 'create' })

    expect(
      await failureOf(
        connect('user-0@tenant.test', { kind: 'reconnect', credentialId: disconnected })
      )
    ).toBe('account_limit_reached')
    expect((await rows()).filter((row) => !row.revokedAt)).toHaveLength(5)
  })

  it('lets the member connect a different account', async () => {
    const first = await connect('work@first-tenant.test', { kind: 'create' })
    await disconnect(first.credentialId)

    const replacement = await connect('work@second-tenant.test', { kind: 'create' })

    expect(replacement.created).toBe(true)
    const after = await rows()
    expect(after.find((row) => row.id === first.credentialId)?.status).toBe('revoked')
    expect(after.find((row) => row.id === replacement.credentialId)?.status).toBe('active')
  })

  it('restores the same credential when the same identity returns', async () => {
    const first = await connect('work@first-tenant.test', { kind: 'create' })
    await disconnect(first.credentialId)

    const restored = await connect('work@first-tenant.test', { kind: 'create' })

    expect(restored).toMatchObject({ created: false, credentialId: first.credentialId })
    expect(await rows()).toHaveLength(1)
    expect((await rows())[0]).toMatchObject({ status: 'active', revokedAt: null })
  })
})

describe('resolving a Slack sender for a member with several Slack accounts', () => {
  const resolve = (slackUserId: string) =>
    resolveSlackSearchMember(organizationId, 'T1', slackUserId, email)

  it('accepts each linked account and refuses a sender linked to neither', async () => {
    await connect('U1@T1', { kind: 'create' }, SLACK)
    await connect('U2@T1', { kind: 'create' }, SLACK)

    await expect(resolve('U1')).resolves.toBe(userId)
    await expect(resolve('U2')).resolves.toBe(userId)
    await expect(resolve('U3')).rejects.toThrow('verified Sim account')
  })

  it('still accepts a member with no linked Slack account', async () => {
    await expect(resolve('U1')).resolves.toBe(userId)
  })
})

describe('invitation links, which carry no connection intent', () => {
  it('refresh the matching identity', async () => {
    const first = await connect('work@first-tenant.test')
    const again = await connect('work@first-tenant.test')
    expect(again).toMatchObject({ created: false, credentialId: first.credentialId })
  })

  it('refuse to silently add a second account beside a live one', async () => {
    await connect('work@first-tenant.test')
    expect(await failureOf(connect('work@second-tenant.test'))).toBe('account_mismatch')
    expect(await rows()).toHaveLength(1)
  })
})

describe('managed MCP accounts', () => {
  const identityOf = (name: string) => ({
    subject: name,
    tenant: 'workspace-1',
    label: `${name}@example.test`,
  })
  const connectMcp = (
    identity: ReturnType<typeof identityOf> | null,
    connectionIntent?: CredentialGroupOAuthAttempt['connectionIntent']
  ) =>
    persistManagedMcpCredential({
      invitationTokenHash: sha256Hex(invitationToken),
      oauthConfigVersion: 1,
      enrollmentId,
      credentialGroupId: groupId,
      email,
      userId,
      organizationId,
      mcpServerId,
      mcpServerName: 'Notion',
      tokens: { access_token: `token-${identity?.subject ?? 'anonymous'}`, token_type: 'bearer' },
      tools: [],
      identity,
      connectionIntent,
    })
  const mcpRows = () =>
    db
      .select({
        id: credential.id,
        subject: credential.providerSubjectId,
        displayName: credential.displayName,
        status: credential.managedOauthStatus,
      })
      .from(credential)
      .where(eq(credential.mcpServerId, mcpServerId))

  it('adds a second identity as its own connection, named for the account', async () => {
    const first = await connectMcp(identityOf('one'), { kind: 'create' })
    const second = await connectMcp(identityOf('two'), { kind: 'create' })

    expect(second.created).toBe(true)
    expect(second.connectionId).not.toBe(first.connectionId)
    expect((await mcpRows()).map((row) => row.displayName).sort()).toEqual([
      'one@example.test',
      'two@example.test',
    ])
  })

  it('refuses an identity that is already connected, and stops at the limit', async () => {
    await connectMcp(identityOf('one'), { kind: 'create' })
    expect(await failureOf(connectMcp(identityOf('one'), { kind: 'create' }))).toBe(
      'account_already_connected'
    )
    for (const name of ['two', 'three', 'four', 'five'])
      await connectMcp(identityOf(name), { kind: 'create' })
    expect(await failureOf(connectMcp(identityOf('six'), { kind: 'create' }))).toBe(
      'account_limit_reached'
    )
    expect(await mcpRows()).toHaveLength(5)
  })

  it('pins reconnect to its account', async () => {
    const first = await connectMcp(identityOf('one'), { kind: 'create' })
    await connectMcp(identityOf('two'), { kind: 'create' })
    const intent = { kind: 'reconnect', credentialId: first.connectionId } as const

    expect(await failureOf(connectMcp(identityOf('two'), intent))).toBe('account_mismatch')
    await expect(connectMcp(identityOf('one'), intent)).resolves.toMatchObject({
      created: false,
      connectionId: first.connectionId,
    })
    expect(await failureOf(connectMcp(null, intent))).toBe('account_unverified')
  })

  it('keeps the People list working when someone has several accounts of one server', async () => {
    await connectMcp(identityOf('one'), { kind: 'create' })
    await connectMcp(identityOf('two'), { kind: 'create' })

    const { enrollments } = await listCredentialGroupEnrollments(
      { kind: 'organization', organizationId },
      groupId,
      10
    )

    expect(enrollments[0]?.mcpConnections).toEqual([
      { mcpServerId, name: 'Notion', status: 'active', count: 2 },
    ])
  })

  it('reconnects a lone account when the provider cannot identify it, keeping its identity', async () => {
    const only = await connectMcp(identityOf('one'), { kind: 'create' })

    await expect(
      connectMcp(null, { kind: 'reconnect', credentialId: only.connectionId })
    ).resolves.toMatchObject({ created: false, connectionId: only.connectionId })
    await expect(connectMcp(null)).resolves.toMatchObject({ connectionId: only.connectionId })

    expect(await mcpRows()).toMatchObject([{ subject: 'one', displayName: 'one@example.test' }])
  })

  it('still connects a first account when the provider cannot identify it', async () => {
    await expect(connectMcp(null, { kind: 'create' })).resolves.toMatchObject({ created: true })
    expect(await mcpRows()).toMatchObject([{ subject: null, displayName: 'Notion' }])
  })

  it('refuses a second account while it cannot tell them apart', async () => {
    await connectMcp(identityOf('one'), { kind: 'create' })
    expect(await failureOf(connectMcp(null, { kind: 'create' }))).toBe('account_unverified')
    expect(await mcpRows()).toHaveLength(1)
  })

  describe('with a connection made before accounts were identified', () => {
    const identifyStored = (result: unknown) => {
      const call = vi.spyOn(mcpService, 'executeManagedMcpTool').mockImplementation(async () => {
        if (result instanceof Error) throw result
        return result as Awaited<ReturnType<typeof mcpService.executeManagedMcpTool>>
      })
      return identifyStoredManagedMcpConnections({
        organizationId,
        enrollmentId,
        server: { id: mcpServerId, connectorId: 'notion' },
      }).finally(() => call.mockRestore())
    }
    const notionSelf = (name: string) => ({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            workspace: { id: 'workspace-1', name: 'Fixture' },
            user: { type: 'person', id: name, email: `${name}@example.test` },
          }),
        },
      ],
    })

    it('identifies it from its stored tokens so another account can be added directly', async () => {
      const legacy = await connectMcp(null, { kind: 'create' })

      await identifyStored(notionSelf('one'))

      expect(await mcpRows()).toMatchObject([
        { id: legacy.connectionId, subject: 'one', displayName: 'one@example.test · Fixture' },
      ])
      await expect(connectMcp(identityOf('two'), { kind: 'create' })).resolves.toMatchObject({
        created: true,
      })
    })

    it('recognizes the same account being added again', async () => {
      await connectMcp(null, { kind: 'create' })
      await identifyStored(notionSelf('one'))
      expect(await failureOf(connectMcp(identityOf('one'), { kind: 'create' }))).toBe(
        'account_already_connected'
      )
    })

    it('keeps the connection unidentified when its tokens no longer work', async () => {
      await connectMcp(null, { kind: 'create' })
      await identifyStored(new Error('token expired'))
      expect(await mcpRows()).toMatchObject([{ subject: null, displayName: 'Notion' }])
      expect(await failureOf(connectMcp(identityOf('two'), { kind: 'create' }))).toBe(
        'account_identity_required'
      )
    })

    it('requires reconnecting it before adding another, then allows both', async () => {
      const legacy = await connectMcp(null, { kind: 'create' })

      expect(await failureOf(connectMcp(identityOf('two'), { kind: 'create' }))).toBe(
        'account_identity_required'
      )

      const reconnected = await connectMcp(identityOf('one'), {
        kind: 'reconnect',
        credentialId: legacy.connectionId,
      })
      expect(reconnected.connectionId).toBe(legacy.connectionId)
      expect(await mcpRows()).toMatchObject([{ subject: 'one', displayName: 'one@example.test' }])

      await connectMcp(identityOf('two'), { kind: 'create' })
      expect(await mcpRows()).toHaveLength(2)
    })

    it('keeps its id when disconnected and connected again, so workflows pinned to it survive', async () => {
      const legacy = await connectMcp(null, { kind: 'create' })
      await disconnect(legacy.connectionId)

      await expect(connectMcp(identityOf('one'), { kind: 'create' })).resolves.toMatchObject({
        created: false,
        connectionId: legacy.connectionId,
      })
      expect(await mcpRows()).toMatchObject([{ id: legacy.connectionId, subject: 'one' }])
    })

    it('refuses to adopt an identity another connection already holds', async () => {
      const held = await connectMcp(identityOf('one'), { kind: 'create' })
      await disconnect(held.connectionId)
      const legacy = await connectMcp(null, { kind: 'create' })

      expect(
        await failureOf(
          connectMcp(identityOf('one'), { kind: 'reconnect', credentialId: legacy.connectionId })
        )
      ).toBe('account_mismatch')
      expect(await failureOf(connectMcp(identityOf('one')))).toBe('account_mismatch')
    })

    it('fills in the identity through an invitation link', async () => {
      const legacy = await connectMcp(null)
      await expect(connectMcp(identityOf('one'))).resolves.toMatchObject({
        created: false,
        connectionId: legacy.connectionId,
      })
      expect(await mcpRows()).toMatchObject([{ subject: 'one', displayName: 'one@example.test' }])
    })
  })

  it('lets a disconnected slot go to a different account, and restores a returning one', async () => {
    const first = await connectMcp(identityOf('one'), { kind: 'create' })
    await disconnect(first.connectionId)

    const replacement = await connectMcp(identityOf('two'), { kind: 'create' })
    expect(replacement.created).toBe(true)

    const restored = await connectMcp(identityOf('one'), { kind: 'create' })
    expect(restored).toMatchObject({ created: false, connectionId: first.connectionId })
  })

  it('does not let an invitation link add a second account', async () => {
    await connectMcp(identityOf('one'))
    expect(await failureOf(connectMcp(identityOf('two')))).toBe('account_mismatch')
    expect(await mcpRows()).toHaveLength(1)
  })

  it('never creates two connections when one identity completes twice at once', async () => {
    await Promise.allSettled([
      connectMcp(identityOf('one'), { kind: 'create' }),
      connectMcp(identityOf('one'), { kind: 'create' }),
    ])
    expect(await mcpRows()).toHaveLength(1)
  })
})
