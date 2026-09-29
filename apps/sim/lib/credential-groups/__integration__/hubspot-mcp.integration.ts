/** Real storage, encryption, and runtime grant binding for the shared HubSpot client. */

import { auth } from '@modelcontextprotocol/sdk/client/auth.js'
import { db } from '@sim/db'
import {
  credential,
  credentialGroupEnrollment,
  mcpServers,
  organization,
  user,
} from '@sim/db/schema'
import { readTestRedisUrl } from '@sim/db/testing/test-infrastructure'
import { sha256Hex } from '@sim/security/hash'
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { env } from '@/lib/core/config/env'
import { encryptSecret } from '@/lib/core/security/encryption'
import {
  completePublicCredentialGroupMcpOAuth,
  startPublicCredentialGroupMcpOAuth,
} from '@/lib/credential-groups/application/public-enrollment'
import { createManagedMcpConnector } from '@/lib/credential-groups/managed-mcp-service'
import { consumeCredentialGroupMcpOAuthAttempt } from '@/lib/credential-groups/mcp-oauth-state'
import { ensureWorkspaceAccountsGroup } from '@/lib/credential-groups/service'
import {
  encryptManagedMcpTokens,
  loadScopedManagedMcpRuntimeCredential,
  saveManagedMcpRuntimeTokens,
} from '@/lib/credentials/managed-mcp'
import * as oauth from '@/lib/mcp/oauth/auth'
import { loadPreregisteredClient } from '@/lib/mcp/oauth/provider'
import { getOrCreateOauthRow, saveClientInformation } from '@/lib/mcp/oauth/storage'
import { mcpService } from '@/lib/mcp/service'

const SECRET = 'isolated-shared-client-secret'
describe('HubSpot shared member connector', () => {
  let owner: string
  let org: string
  let group: string
  beforeEach(async () => {
    Object.assign(env, {
      REDIS_URL: readTestRedisUrl(),
      HUBSPOT_MCP_CLIENT_ID: 'fixture-shared-client',
      HUBSPOT_MCP_CLIENT_SECRET: SECRET,
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
      input: { connectorId: 'hubspot' },
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
  it('rejects incomplete shared configuration instead of falling back to the ordinary OAuth app', async () => {
    Object.assign(env, {
      HUBSPOT_MCP_CLIENT_SECRET: undefined,
      HUBSPOT_CLIENT_ID: 'rest-client',
      HUBSPOT_CLIENT_SECRET: 'rest-secret',
    })
    await expect(create()).rejects.toThrow(/HubSpot.*configured/i)
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
  it('rejects a grant after shared client rotation and rejects an unbound platform grant', async () => {
    const { mcpServer } = await create()
    const client = await loadPreregisteredClient(mcpServer.id)
    const id = await grant(mcpServer.id, client?.configurationFingerprint)
    expect((await runtime(id)).tokens.access_token).toBe('fixture-access')
    Object.assign(env, { HUBSPOT_MCP_CLIENT_SECRET: 'rotated-secret' })
    await expect(runtime(id)).rejects.toThrow(/authorization/)
    Object.assign(env, { HUBSPOT_MCP_CLIENT_SECRET: SECRET })
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
    Object.assign(env, { HUBSPOT_MCP_CLIENT_SECRET: 'rotated-secret' })
    await expect(runtime(id)).rejects.toThrow(/authorization/)
  })
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
      if (url.pathname.includes('oauth-protected-resource'))
        return Response.json({
          resource: 'https://mcp.hubspot.com',
          authorization_servers: [issuer],
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
          token_endpoint_auth_methods_supported: ['client_secret_post'],
        })
      if (url.href === `${issuer}/token`) {
        exchanges++
        const body = new URLSearchParams(String(init?.body))
        expect(body.get('client_id')).toBe('fixture-shared-client')
        expect(body.get('client_secret')).toBe(SECRET)
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
    vi.spyOn(oauth, 'mcpAuthGuarded').mockImplementation((provider, options) =>
      auth(provider, { ...options, fetchFn })
    )
    vi.spyOn(mcpService, 'discoverManagedMcpTools').mockResolvedValue([])
    const start = async () => {
      const result = await startPublicCredentialGroupMcpOAuth.execute({
        principal,
        input: { mcpServerId: mcpServer.id, invitationToken: token },
      })
      const url = new URL(result.authorizationUrl)
      expect(url.searchParams.get('client_id')).toBe('fixture-shared-client')
      expect(url.searchParams.get('code_challenge_method')).toBe('S256')
      challenge = url.searchParams.get('code_challenge')
      expect(challenge).toBeTruthy()
      const attempt = await consumeCredentialGroupMcpOAuthAttempt(url.searchParams.get('state')!)
      expect(attempt).not.toBeNull()
      return attempt!
    }
    const attempt = await start()
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
    const next = await start()
    Object.assign(env, { HUBSPOT_MCP_CLIENT_SECRET: 'rotated-secret' })
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
