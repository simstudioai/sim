import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { db } from '@sim/db'
import { member, organization, user } from '@sim/db/schema'
import { readTestRedisUrl } from '@sim/db/testing/test-infrastructure'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { generateId } from '@sim/utils/id'
import { toRecord } from '@sim/utils/object'
import { inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { env } from '@/lib/core/config/env'
import {
  resolveCurrentOutboundRoute,
  runWithOutboundOrganization,
} from '@/lib/core/network/context.server'
import { startOrganizationAccountConnection } from '@/lib/credential-groups/application/organization-accounts'
import { createManagedMcpConnector } from '@/lib/credential-groups/managed-mcp-service'
import { consumeCredentialGroupMcpOAuthAttempt } from '@/lib/credential-groups/mcp-oauth-state'
import { ensureWorkspaceAccountsGroup } from '@/lib/credential-groups/service'
import * as oauth from '@/lib/mcp/oauth/auth'
import { createSsrfGuardedMcpFetch } from '@/lib/mcp/pinned-fetch'

const RESOURCE = 'https://mcp.lucid.app/mcp/readonly'
const ISSUER = 'https://oauth.fixture.test'
const owner = generateId()
const blockedOwner = generateId()
const outsider = generateId()
const directOrg = generateId()
const blockedOrg = generateId()
const servers = new Map<string, string>()
const requests: string[] = []

/** Real OAuth discovery and registration over a socket; only the remote destination is replaced. */
const providerServer = createServer(async (request, response) => {
  const path = request.url ?? '/'
  requests.push(path)
  response.setHeader('content-type', 'application/json')
  if (path.includes('oauth-protected-resource')) {
    response.end(JSON.stringify({ resource: RESOURCE, authorization_servers: [ISSUER] }))
  } else if (path.includes('oauth-authorization-server') || path.includes('openid-configuration')) {
    response.end(
      JSON.stringify({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/authorize`,
        token_endpoint: `${ISSUER}/token`,
        registration_endpoint: `${ISSUER}/register`,
        response_types_supported: ['code'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
      })
    )
  } else if (path === '/register' && request.method === 'POST') {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const metadata: unknown = JSON.parse(Buffer.concat(chunks).toString())
    response.writeHead(201).end(
      JSON.stringify({
        ...toRecord(metadata),
        client_id: 'fixture-dynamic-client',
      })
    )
  } else {
    response.writeHead(404).end(JSON.stringify({ error: 'unknown fixture endpoint' }))
  }
})

beforeAll(async () => {
  Object.assign(env, {
    REDIS_URL: readTestRedisUrl(),
    OUTBOUND_ROUTING_SOURCE: 'env',
    OUTBOUND_ROUTING_CONFIG: JSON.stringify({
      schemaVersion: 1,
      revision: 'account-oauth-fixture',
      organizations: { [directOrg]: { kind: 'direct' }, [blockedOrg]: { kind: 'blocked' } },
    }),
    OUTBOUND_GATEWAYS: JSON.stringify({
      direct: {
        organizationId: directOrg,
        url: 'https://direct.fixture.test/',
        credentialId: 'direct',
      },
      blocked: {
        organizationId: blockedOrg,
        url: 'https://blocked.fixture.test/',
        credentialId: 'blocked',
      },
    }),
    OUTBOUND_GATEWAY_CREDENTIALS: JSON.stringify({
      direct: { token: 'd'.repeat(32) },
      blocked: { token: 'b'.repeat(32) },
    }),
  })
  await db.insert(user).values(
    [owner, blockedOwner, outsider].map((id) => ({
      id,
      name: 'OAuth fixture',
      email: `${id}@fixture.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }))
  )
  for (const organizationId of [directOrg, blockedOrg]) {
    const userId = organizationId === directOrg ? owner : blockedOwner
    await db
      .insert(organization)
      .values({ id: organizationId, name: 'OAuth fixture', slug: organizationId })
    await db.insert(member).values({ id: generateId(), organizationId, userId, role: 'owner' })
    const group = await ensureWorkspaceAccountsGroup(
      { kind: 'organization', organizationId },
      userId
    )
    const { mcpServer } = await db.transaction((tx) =>
      createManagedMcpConnector(
        {
          organizationId,
          credentialGroupId: group.id,
          userId,
          validated: { input: { connectorId: 'lucid' }, url: RESOURCE },
        },
        tx
      )
    )
    servers.set(organizationId, mcpServer.id)
  }
  await new Promise<void>((resolve) => providerServer.listen(0, '127.0.0.1', resolve))
  const address = providerServer.address()
  if (!address || typeof address === 'string') throw new Error('OAuth fixture did not bind')
  const origin = `http://127.0.0.1:${address.port}`
  const guardedFetch = createSsrfGuardedMcpFetch({ serverUrl: origin })
  const authenticate = oauth.mcpAuthGuarded
  vi.spyOn(oauth, 'mcpAuthGuarded').mockImplementation((provider, options) =>
    authenticate(provider, {
      ...options,
      fetchFn: (input, init) => {
        const remote = new URL(input instanceof Request ? input.url : input)
        if (![new URL(RESOURCE).origin, ISSUER].includes(remote.origin)) {
          throw new Error('Unexpected OAuth fixture origin')
        }
        return guardedFetch(new URL(`${remote.pathname}${remote.search}`, origin), init)
      },
    })
  )
})

afterAll(async () => {
  if (providerServer.listening)
    await new Promise<void>((resolve, reject) => {
      providerServer.close((error) => (error ? reject(error) : resolve()))
      providerServer.closeAllConnections()
    })
  await db.delete(organization).where(inArray(organization.id, [directOrg, blockedOrg]))
  await db.delete(user).where(inArray(user.id, [owner, blockedOwner, outsider]))
})

function connect(
  organizationId: string,
  userId = owner,
  mcpServerId = servers.get(organizationId)!
) {
  return startOrganizationAccountConnection.execute({
    principal: createSessionPrincipal({ userId, sessionId: generateId() }),
    input: {
      organizationId,
      mcpServerId,
      oauthCompletionId: generateId(),
      returnTo: 'integrations',
    },
  })
}

async function verifyAuthorization() {
  const result = await connect(directOrg)
  const authorization = new URL(result.authorizationUrl)
  expect(`${authorization.origin}${authorization.pathname}`).toBe(`${ISSUER}/authorize`)
  expect(authorization.searchParams.get('client_id')).toBe('fixture-dynamic-client')
  expect(authorization.searchParams.get('code_challenge_method')).toBe('S256')
  const state = authorization.searchParams.get('state')!
  const attempt = await consumeCredentialGroupMcpOAuthAttempt(state)
  expect(attempt).toMatchObject({
    organizationId: directOrg,
    userId: owner,
    mcpServerId: servers.get(directOrg),
    returnTo: 'integrations',
  })
  expect(authorization.searchParams.get('code_challenge')).toBe(
    createHash('sha256').update(attempt!.codeVerifier).digest('base64url')
  )
  expect(await consumeCredentialGroupMcpOAuthAttempt(state)).toBeNull()
}

describe('Organization account OAuth outbound ownership', () => {
  it('starts dynamic OAuth with a bound single-use attempt when no ambient scope exists', async () => {
    await verifyAuthorization()
    await expect(resolveCurrentOutboundRoute()).rejects.toMatchObject({ code: 'MISSING_SCOPE' })
  })
  it('uses authorized ownership instead of an ambient blocked organization and restores the outer scope', async () => {
    await runWithOutboundOrganization(blockedOrg, async () => {
      await verifyAuthorization()
      await expect(resolveCurrentOutboundRoute()).rejects.toMatchObject({ code: 'ROUTE_BLOCKED' })
    })
  })
  it('does not bypass an organization block through ambient platform scope', async () => {
    const before = requests.length
    await runWithOutboundOrganization(null, async () => {
      await expect(connect(blockedOrg, blockedOwner)).rejects.toMatchObject({
        code: 'ROUTE_BLOCKED',
      })
      expect(await resolveCurrentOutboundRoute()).toEqual({ kind: 'direct' })
    })
    expect(requests.length).toBe(before)
  })
  it('denies nonmembers and cross-organization providers before contacting OAuth', async () => {
    const before = requests.length
    await expect(connect(directOrg, outsider)).rejects.toMatchObject({ code: 'not_found' })
    await expect(connect(directOrg, owner, servers.get(blockedOrg))).rejects.toMatchObject({
      code: 'not_found',
    })
    expect(requests.length).toBe(before)
  })
})
