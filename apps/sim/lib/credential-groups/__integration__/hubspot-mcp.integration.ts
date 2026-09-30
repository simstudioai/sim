/** Real storage, encryption, SDK exchange, and runtime binding for shared MCP clients. */

import { db } from '@sim/db'
import {
  credential,
  credentialGroupEnrollment,
  mcpServers,
  member,
  organization,
  user,
} from '@sim/db/schema'
import { readTestRedisUrl } from '@sim/db/testing/test-infrastructure'
import { sha256Hex } from '@sim/security/hash'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { env } from '@/lib/core/config/env'
import { encryptSecret } from '@/lib/core/security/encryption'
import { getOrganizationAccountsSettings } from '@/lib/credential-groups/application/organization-accounts'
import { disconnectPersonalOrganizationAccount } from '@/lib/credential-groups/application/personal-organization-accounts'
import {
  completePublicCredentialGroupMcpOAuth,
  startPublicCredentialGroupMcpOAuth,
} from '@/lib/credential-groups/application/public-enrollment'
import { createManagedMcpConnector } from '@/lib/credential-groups/managed-mcp-service'
import { consumeCredentialGroupMcpOAuthAttempt } from '@/lib/credential-groups/mcp-oauth-state'
import { listConfiguredManagedMcpConnectors } from '@/lib/credential-groups/provider-availability'
import { ensureWorkspaceAccountsGroup } from '@/lib/credential-groups/service'
import {
  encryptManagedMcpTokens,
  loadScopedManagedMcpRuntimeCredential,
  saveManagedMcpRuntimeTokens,
} from '@/lib/credentials/managed-mcp'
import { createManagedMcpAuthProvider } from '@/lib/mcp/application/managed-auth-provider'
import * as oauth from '@/lib/mcp/oauth/auth'
import { createCoordinatedMcpOauthFetch } from '@/lib/mcp/oauth/coordinated-fetch'
import {
  loadPreregisteredClient,
  McpOauthRedirectRequired,
  SimMcpOauthProvider,
} from '@/lib/mcp/oauth/provider'
import { getOrCreateOauthRow, saveClientInformation } from '@/lib/mcp/oauth/storage'
import { mcpService } from '@/lib/mcp/service'
import { listManagedMcpSearchAccounts } from '@/lib/sim-search/live/mcp-accounts'

const SECRET = 'isolated-shared-client-secret'
const SHARED_CLIENTS = [
  {
    id: 'hubspot',
    name: 'HubSpot',
    clientIdKey: 'HUBSPOT_MCP_CLIENT_ID',
    clientSecretKey: 'HUBSPOT_MCP_CLIENT_SECRET',
    url: 'https://mcp.hubspot.com',
    tokenAuthMethod: 'client_secret_post',
    scope: undefined,
  },
  {
    id: 'zoom',
    name: 'Zoom',
    clientIdKey: 'ZOOM_MCP_CLIENT_ID',
    clientSecretKey: 'ZOOM_MCP_CLIENT_SECRET',
    url: 'https://mcp.zoom.us/mcp/meeting/streamable',
    tokenAuthMethod: 'client_secret_basic',
    scope: 'meeting:read:search meeting:read:assets',
  },
] as const

describe.each(SHARED_CLIENTS)('$name shared member connector', (connector) => {
  let owner: string
  let org: string
  let group: string
  beforeEach(async () => {
    Object.assign(env, {
      REDIS_URL: readTestRedisUrl(),
      ZOOM_SEARCH: true,
      [connector.clientIdKey]: 'fixture-shared-client',
      [connector.clientSecretKey]: SECRET,
    })
    owner = generateId()
    org = generateId()
    await db.insert(user).values({
      id: owner,
      name: 'Fixture',
      email: `${owner}@fixture.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    await db.insert(organization).values({ id: org, name: 'Fixture', slug: org })
    group = (
      await ensureWorkspaceAccountsGroup({ kind: 'organization', organizationId: org }, owner)
    ).id
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await db.delete(organization).where(eq(organization.id, org))
    await db.delete(user).where(eq(user.id, owner))
  })
  const create = () =>
    createManagedMcpConnector({
      organizationId: org,
      credentialGroupId: group,
      userId: owner,
      input: { connectorId: connector.id },
    })
  const stored = async (id: string) => {
    const [row] = await db.select().from(mcpServers).where(eq(mcpServers.id, id))
    if (!row) throw new Error('Missing fixture server')
    return row
  }
  const grant = async (serverId: string, fingerprint?: string) => {
    const enrollmentId = generateId()
    const id = `mcp-cg-${generateId()}`
    await db.insert(credentialGroupEnrollment).values({
      id: enrollmentId,
      credentialGroupId: group,
      userId: owner,
      email: `${owner}@fixture.test`,
      status: 'completed',
      invitationTokenHash: sha256Hex(generateId()),
      invitationExpiresAt: new Date(Date.now() + 60_000),
      invitedAt: new Date(),
    })
    await db.insert(credential).values({
      id,
      organizationId: org,
      type: 'managed_mcp',
      displayName: 'Fixture',
      grantedAt: new Date(),
      mcpTools: [],
      credentialGroupEnrollmentId: enrollmentId,
      mcpServerId: serverId,
      mcpOauthConfigVersion: (await stored(serverId)).oauthConfigVersion,
      managedOauthStatus: 'active',
      encryptedOauthTokenSet: await encryptManagedMcpTokens(
        {
          access_token: 'fixture-access',
          refresh_token: 'fixture-refresh',
          token_type: 'Bearer',
        },
        fingerprint
      ),
    })
    return id
  }
  const runtime = (id: string) =>
    loadScopedManagedMcpRuntimeCredential(id, { kind: 'organization', organizationId: org }, owner)

  it('uses shared registration without copying credentials into organization storage or responses', async () => {
    const result = await create()
    expect(JSON.stringify(result)).not.toContain(SECRET)
    const row = await stored(result.mcpServer.id)
    expect(row.oauthClientId).toBeNull()
    expect(row.oauthClientSecret).toBeNull()
    expect(await loadPreregisteredClient(row.id)).toMatchObject({
      clientId: 'fixture-shared-client',
      clientSecret: SECRET,
    })
  })
  it('rejects incomplete shared configuration before persisting a server', async () => {
    Object.assign(env, {
      [connector.clientSecretKey]: undefined,
      HUBSPOT_CLIENT_ID: 'rest-client',
      HUBSPOT_CLIENT_SECRET: 'rest-secret',
      ZOOM_CLIENT_ID: 'workflow-client',
      ZOOM_CLIENT_SECRET: 'workflow-secret',
    })
    await expect(create()).rejects.toThrow(new RegExp(`${connector.name}.*configured`, 'i'))
    expect(
      await db.select().from(mcpServers).where(eq(mcpServers.credentialGroupId, group))
    ).toEqual([])
  })
  it('never releases shared credentials to a substituted endpoint, different provider, disabled, or deleted server', async () => {
    const { mcpServer } = await create()
    const baseline = await stored(mcpServer.id)
    for (const change of [
      { url: 'https://example.com/mcp' },
      { managedConnectorId: 'notion' },
      { enabled: false },
      { deletedAt: new Date() },
    ]) {
      await db.update(mcpServers).set(change).where(eq(mcpServers.id, mcpServer.id))
      await expect(loadPreregisteredClient(mcpServer.id)).resolves.toBeUndefined()
      await db
        .update(mcpServers)
        .set({
          url: baseline.url,
          managedConnectorId: baseline.managedConnectorId,
          credentialGroupId: baseline.credentialGroupId,
          enabled: baseline.enabled,
          deletedAt: baseline.deletedAt,
        })
        .where(eq(mcpServers.id, mcpServer.id))
    }
  })
  if (connector.id === 'hubspot') {
    it('retains saved registrations and rejects partial or corrupt saved data without switching clients', async () => {
      const { mcpServer } = await create()
      const encrypted = (await encryptSecret('saved-secret')).encrypted
      await db
        .update(mcpServers)
        .set({ oauthClientId: 'saved-client', oauthClientSecret: encrypted })
        .where(eq(mcpServers.id, mcpServer.id))
      Object.assign(env, { HUBSPOT_MCP_CLIENT_ID: undefined, HUBSPOT_MCP_CLIENT_SECRET: undefined })
      const existingGrant = await grant(mcpServer.id)
      expect((await runtime(existingGrant)).tokens.access_token).toBe('fixture-access')
      expect(await loadPreregisteredClient(mcpServer.id)).toEqual({
        clientId: 'saved-client',
        clientSecret: 'saved-secret',
      })
      for (const change of [
        { oauthClientId: null, oauthClientSecret: encrypted },
        { oauthClientId: 'saved-client', oauthClientSecret: null },
        { oauthClientId: 'saved-client', oauthClientSecret: 'corrupt' },
      ]) {
        await db.update(mcpServers).set(change).where(eq(mcpServers.id, mcpServer.id))
        await expect(loadPreregisteredClient(mcpServer.id)).rejects.toThrow()
      }
    })
  }
  it('rejects a grant after shared client rotation and rejects an unbound platform grant', async () => {
    const { mcpServer } = await create()
    const client = await loadPreregisteredClient(mcpServer.id)
    const id = await grant(mcpServer.id, client?.configurationFingerprint)
    expect((await runtime(id)).tokens.access_token).toBe('fixture-access')
    Object.assign(env, { [connector.clientSecretKey]: 'rotated-secret' })
    await expect(runtime(id)).rejects.toThrow(/authorization/)
    Object.assign(env, { [connector.clientSecretKey]: SECRET })
    await db
      .update(credential)
      .set({
        encryptedOauthTokenSet: await encryptManagedMcpTokens({
          access_token: 'unbound-fixture',
          token_type: 'Bearer',
        }),
      })
      .where(eq(credential.id, id))
    await expect(runtime(id)).rejects.toThrow(/authorization/)
  })
  it('preserves shared registration binding through refresh and retains token compare-and-swap', async () => {
    const { mcpServer } = await create()
    const client = await loadPreregisteredClient(mcpServer.id)
    const id = await grant(mcpServer.id, client?.configurationFingerprint)
    const before = await runtime(id)
    await saveManagedMcpRuntimeTokens(
      id,
      { access_token: 'refreshed', token_type: 'Bearer' },
      before.tokenVersion
    )
    expect((await runtime(id)).tokens.access_token).toBe('refreshed')
    await expect(
      saveManagedMcpRuntimeTokens(
        id,
        { access_token: 'stale', token_type: 'Bearer' },
        before.tokenVersion
      )
    ).rejects.toThrow(/changed/)
    Object.assign(env, { [connector.clientSecretKey]: 'rotated-secret' })
    await expect(runtime(id)).rejects.toThrow(/authorization/)
  })
  if (connector.id === 'zoom') {
    it('refuses new Zoom sign-in servers when the rollout is off without persisting setup', async () => {
      Object.assign(env, { ZOOM_SEARCH: false })
      await expect(create()).rejects.toThrow(/Zoom Search.*not available/)
      expect(
        await db.select().from(mcpServers).where(eq(mcpServers.credentialGroupId, group))
      ).toEqual([])
    })
    it('hides existing Zoom grants from enrollment and Search inventories when the rollout is off', async () => {
      await db.insert(member).values({
        id: generateId(),
        organizationId: org,
        userId: owner,
        role: 'owner',
      })
      const { mcpServer } = await create()
      const client = await loadPreregisteredClient(mcpServer.id)
      const id = await grant(mcpServer.id, client?.configurationFingerprint)
      const scope = { kind: 'organization', organizationId: org } as const
      expect(await listConfiguredManagedMcpConnectors(group, scope)).toContain('zoom')
      expect(
        (await listManagedMcpSearchAccounts({ organizationId: org }, owner)).map((row) => row.id)
      ).toContain(id)
      Object.assign(env, { ZOOM_SEARCH: false })
      expect(await listConfiguredManagedMcpConnectors(group, scope)).not.toContain('zoom')
      expect(await listManagedMcpSearchAccounts({ organizationId: org }, owner)).toEqual([])
      const principal = createSessionPrincipal({ userId: owner, sessionId: generateId() })
      const settings = await getOrganizationAccountsSettings.execute({
        principal,
        input: { organizationId: org },
      })
      expect(settings.viewerMcpAccounts).toContainEqual(
        expect.objectContaining({ credentialId: id, mcpServerId: mcpServer.id })
      )
      expect(settings.availableMcpConnectors).not.toContain('zoom')
      Object.assign(env, { ZOOM_SEARCH: true })
      expect(
        (await listManagedMcpSearchAccounts({ organizationId: org }, owner)).map((row) => row.id)
      ).toContain(id)
      Object.assign(env, { ZOOM_SEARCH: false })
      await disconnectPersonalOrganizationAccount.execute({
        principal,
        input: { credentialId: id },
      })
      const disconnected = await getOrganizationAccountsSettings.execute({
        principal,
        input: { organizationId: org },
      })
      expect(disconnected.viewerMcpAccounts).toEqual([])
      Object.assign(env, { ZOOM_SEARCH: true })
      expect(await listManagedMcpSearchAccounts({ organizationId: org }, owner)).toEqual([])
    })
    it('blocks existing Zoom runtime grants after rollout disablement and permits them after re-enable', async () => {
      const { mcpServer } = await create()
      const client = await loadPreregisteredClient(mcpServer.id)
      const id = await grant(mcpServer.id, client?.configurationFingerprint)
      expect((await runtime(id)).tokens.access_token).toBe('fixture-access')
      Object.assign(env, { ZOOM_SEARCH: false })
      await expect(runtime(id)).rejects.toThrow(/Zoom Search.*not available/)
      Object.assign(env, { ZOOM_SEARCH: true })
      expect((await runtime(id)).tokens.access_token).toBe('fixture-access')
    })
    it('does not release the shared Zoom OAuth registration when the organization rollout is off', async () => {
      const { mcpServer } = await create()
      Object.assign(env, { ZOOM_SEARCH: false })
      await expect(loadPreregisteredClient(mcpServer.id)).rejects.toThrow(
        /Zoom Search.*not available/
      )
    })
    it.each(['initial consent', 'runtime scope challenge'] as const)(
      'restricts generic OAuth %s to registered read permissions',
      async (phase) => {
        const { mcpServer } = await create()
        const issuer = 'https://oauth.fixture.test'
        const loadProvider = async () =>
          new SimMcpOauthProvider({
            row: await getOrCreateOauthRow({ mcpServerId: mcpServer.id, organizationId: org }),
            preregistered: await loadPreregisteredClient(mcpServer.id),
          })
        const provider = await loadProvider()
        const fetchFn: typeof fetch = async (request) => {
          const url = new URL(
            typeof request === 'string' ? request : request instanceof URL ? request : request.url
          )
          if (url.href === connector.url)
            return new Response(null, {
              status: 403,
              headers: {
                'www-authenticate':
                  'Bearer error="insufficient_scope", scope="meeting:write:meeting"',
              },
            })
          if (url.pathname.includes('oauth-protected-resource'))
            return Response.json({
              resource: connector.url,
              authorization_servers: [issuer],
              scopes_supported: [...connector.scope.split(' '), 'meeting:write:meeting'],
            })
          if (
            url.pathname.includes('oauth-authorization-server') ||
            url.pathname.includes('openid-configuration')
          )
            return Response.json({
              issuer,
              authorization_endpoint: `${issuer}/authorize`,
              token_endpoint: `${issuer}/token`,
              response_types_supported: ['code'],
              code_challenge_methods_supported: ['S256'],
              token_endpoint_auth_methods_supported: [connector.tokenAuthMethod],
            })
          throw new Error(`Unexpected OAuth fixture request: ${url.origin}${url.pathname}`)
        }
        try {
          if (phase === 'initial consent') {
            await oauth.mcpAuthGuarded(provider, { serverUrl: connector.url, fetchFn })
          } else {
            await provider.saveTokens({ access_token: 'fixture-access', token_type: 'Bearer' })
            const request = createCoordinatedMcpOauthFetch(
              { credentialId: mcpServer.id, loadProvider, initialProvider: provider },
              { serverUrl: connector.url, fetch: fetchFn }
            )
            await request(connector.url, { method: 'POST' })
          }
          throw new Error('Expected authorization to require consent')
        } catch (error) {
          if (!(error instanceof McpOauthRedirectRequired)) throw error
          const authorization = new URL(error.authorizationUrl)
          expect(authorization.searchParams.get('scope')).toBe(connector.scope)
          expect(authorization.searchParams.get('code_challenge_method')).toBe('S256')
          const storedProvider = await loadProvider()
          expect(
            Buffer.from(sha256Hex(await storedProvider.codeVerifier()), 'hex').toString('base64url')
          ).toBe(authorization.searchParams.get('code_challenge'))
        }
      }
    )
  }
  it('binds the public OAuth round trip to the shared client and rejects rotation before exchange', async () => {
    const { mcpServer } = await create()
    const token = generateId()
    const enrollmentId = generateId()
    const email = `${owner}@fixture.test`
    await db.insert(credentialGroupEnrollment).values({
      id: enrollmentId,
      credentialGroupId: group,
      userId: owner,
      email,
      status: 'in_progress',
      invitationTokenHash: sha256Hex(token),
      invitationExpiresAt: new Date(Date.now() + 60_000),
      invitedAt: new Date(),
    })
    const principal = {
      kind: 'credential_group_enrollment' as const,
      userId: owner,
      organizationId: org,
      credentialGroupId: group,
      enrollmentId,
      email,
      invitationTokenHash: sha256Hex(token),
    }
    const row = await getOrCreateOauthRow({ mcpServerId: mcpServer.id, organizationId: org })
    await saveClientInformation(row.id, {
      client_id: 'stale-dynamic-client',
      redirect_uris: ['http://localhost:3000/api/mcp/oauth/callback'],
    })
    let exchanges = 0
    let challenge: string | null = null
    const issuer = 'https://oauth.fixture.test'
    /** Only provider HTTP is substituted; SDK, PKCE, Redis, use cases, encryption and database are real. */
    const fetchFn: typeof fetch = async (request, init) => {
      const url = new URL(
        typeof request === 'string' ? request : request instanceof URL ? request : request.url
      )
      if (url.href === connector.url)
        return new Response(null, {
          status: 403,
          headers: {
            'www-authenticate': 'Bearer error="insufficient_scope", scope="meeting:write:meeting"',
          },
        })
      if (url.pathname.includes('oauth-protected-resource'))
        return Response.json({
          resource: connector.url,
          authorization_servers: [issuer],
          ...(connector.scope
            ? { scopes_supported: [...connector.scope.split(' '), 'meeting:write:meeting'] }
            : {}),
        })
      if (
        url.pathname.includes('oauth-authorization-server') ||
        url.pathname.includes('openid-configuration')
      )
        return Response.json({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          response_types_supported: ['code'],
          code_challenge_methods_supported: ['S256'],
          token_endpoint_auth_methods_supported: [connector.tokenAuthMethod],
          ...(connector.scope
            ? { scopes_supported: [...connector.scope.split(' '), 'meeting:write:meeting'] }
            : {}),
        })
      if (url.href === `${issuer}/token`) {
        exchanges++
        const body = new URLSearchParams(String(init?.body))
        if (connector.tokenAuthMethod === 'client_secret_basic') {
          expect(new Headers(init?.headers).get('Authorization')).toBe(
            `Basic ${Buffer.from(`fixture-shared-client:${SECRET}`).toString('base64')}`
          )
          expect(body.has('client_id')).toBe(false)
          expect(body.has('client_secret')).toBe(false)
        } else {
          expect(body.get('client_id')).toBe('fixture-shared-client')
          expect(body.get('client_secret')).toBe(SECRET)
        }
        expect(
          Buffer.from(sha256Hex(body.get('code_verifier') ?? ''), 'hex').toString('base64url')
        ).toBe(challenge)
        return Response.json({
          access_token: 'exchanged-token',
          refresh_token: 'exchanged-refresh',
          token_type: 'Bearer',
        })
      }
      throw new Error(`Unexpected OAuth fixture request: ${url.origin}${url.pathname}`)
    }
    const authenticate = oauth.mcpAuthGuarded
    vi.spyOn(oauth, 'mcpAuthGuarded').mockImplementation((provider, options) =>
      authenticate(provider, { ...options, fetchFn })
    )
    vi.spyOn(mcpService, 'discoverManagedMcpTools').mockResolvedValue([])
    const start = async () => {
      const result = await startPublicCredentialGroupMcpOAuth.execute({
        principal,
        input: { mcpServerId: mcpServer.id, invitationToken: token },
      })
      const url = new URL(result.authorizationUrl)
      expect(url.searchParams.get('client_id')).toBe('fixture-shared-client')
      if (connector.scope) expect(url.searchParams.get('scope')).toBe(connector.scope)
      expect(url.searchParams.get('code_challenge_method')).toBe('S256')
      challenge = url.searchParams.get('code_challenge')
      expect(challenge).toBeTruthy()
      const attempt = await consumeCredentialGroupMcpOAuthAttempt(url.searchParams.get('state')!)
      expect(attempt).not.toBeNull()
      return attempt!
    }
    const attempt = await start()
    if (connector.id === 'zoom') {
      Object.assign(env, { ZOOM_SEARCH: false })
      await expect(start()).rejects.toThrow(/invalid|expired|available/i)
      await expect(
        completePublicCredentialGroupMcpOAuth.execute({
          principal,
          input: { attempt, code: 'disabled-code' },
        })
      ).rejects.toMatchObject({
        name: 'CredentialGroupInvitationUnavailableError',
        statusCode: 409,
      })
      expect(exchanges).toBe(0)
      expect(
        await db
          .select()
          .from(credential)
          .where(eq(credential.credentialGroupEnrollmentId, enrollmentId))
      ).toEqual([])
      Object.assign(env, { ZOOM_SEARCH: true })
    }
    await completePublicCredentialGroupMcpOAuth.execute({
      principal,
      input: { attempt, code: 'fixture-code' },
    })
    const [saved] = await db
      .select({ id: credential.id })
      .from(credential)
      .where(eq(credential.credentialGroupEnrollmentId, enrollmentId))
    expect((await runtime(saved!.id)).tokens.access_token).toBe('exchanged-token')
    expect(exchanges).toBe(1)
    if (connector.scope) {
      const current = await runtime(saved!.id)
      await saveManagedMcpRuntimeTokens(
        saved!.id,
        { access_token: 'exchanged-token', token_type: 'Bearer' },
        current.tokenVersion
      )
      const loadProvider = async () => createManagedMcpAuthProvider(await runtime(saved!.id))
      const request = createCoordinatedMcpOauthFetch(
        { credentialId: saved!.id, loadProvider, initialProvider: await loadProvider() },
        { serverUrl: connector.url, fetch: fetchFn }
      )
      try {
        await request(connector.url, { method: 'POST' })
        throw new Error('Expected the scope challenge to require authorization')
      } catch (error) {
        if (!(error instanceof McpOauthRedirectRequired)) throw error
        const authorization = new URL(error.authorizationUrl)
        expect(authorization.searchParams.get('scope')).toBe(connector.scope)
        expect(authorization.searchParams.get('code_challenge_method')).toBe('S256')
      }
    }
    const next = await start()
    Object.assign(env, { [connector.clientSecretKey]: 'rotated-secret' })
    await expect(
      completePublicCredentialGroupMcpOAuth.execute({
        principal,
        input: { attempt: next, code: 'another-code' },
      })
    ).rejects.toThrow(/changed/)
    expect(exchanges).toBe(1)
    const grants = await db
      .select({ id: credential.id })
      .from(credential)
      .where(eq(credential.credentialGroupEnrollmentId, enrollmentId))
    expect(grants).toEqual([{ id: saved!.id }])
  })
})
