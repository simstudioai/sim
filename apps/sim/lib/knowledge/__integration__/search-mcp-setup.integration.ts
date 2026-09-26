import { db } from '@sim/db'
import {
  credentialGroup,
  mcpServers,
  member,
  organization,
  organizationSearchIntegration,
  resourcePolicy,
  user,
} from '@sim/db/schema'
import * as dns from '@sim/security/dns'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { getPostgresErrorCode } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { toRecord } from '@sim/utils/object'
import { eq, inArray, sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createOrganizationAccountsGroup } from '@/lib/credential-groups/workspace-accounts'
import { approveSearchIntegration } from '@/lib/knowledge/application/search-integrations'
import { defaultLiveSearchPolicy } from '@/lib/sim-search/live/policy-schema'

/**
 * Real authorization, transactions, constraints and persistence; only DNS is a fixture.
 * Run with TEST_DATABASE_URL naming a disposable database and pass
 * --outputFile.json="$SEARCH_MCP_SETUP_REPORT_PATH" for a caller-selected JSON report.
 */
describe('atomic organization live Search MCP setup', () => {
  let ids: { organization: string; owner: string; member: string; outsider: string }

  beforeAll(() => {
    vi.spyOn(dns, 'resolveHostAddresses').mockImplementation(async (hostname) => {
      if (!['api.fireflies.ai', 'mcp.granola.ai', 'mcp.notion.com'].includes(hostname))
        throw new Error(`Unexpected DNS lookup in setup fixture: ${hostname}`)
      return { addresses: ['93.184.216.34'], preferred: '93.184.216.34' }
    })
  })

  beforeEach(async () => {
    ids = {
      organization: generateId(),
      owner: generateId(),
      member: generateId(),
      outsider: generateId(),
    }
    await db.insert(user).values(
      [ids.owner, ids.member, ids.outsider].map((id) => ({
        id,
        name: 'Search setup fixture',
        email: `${id}@fixture.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }))
    )
    await db.insert(organization).values({
      id: ids.organization,
      name: 'Search setup fixture',
      slug: ids.organization,
      metadata: { preserved: 'organization setting' },
    })
    await db.insert(member).values([
      { id: generateId(), organizationId: ids.organization, userId: ids.owner, role: 'owner' },
      { id: generateId(), organizationId: ids.organization, userId: ids.member, role: 'member' },
    ])
  })

  afterEach(async () => {
    await db.delete(organization).where(eq(organization.id, ids.organization))
    await db.delete(user).where(inArray(user.id, [ids.owner, ids.member, ids.outsider]))
  })
  afterAll(async () => {
    await db.$client.end()
  })

  const approve = (provider: string, userId = ids.owner) =>
    approveSearchIntegration.execute({
      principal: createSessionPrincipal({ userId, sessionId: generateId() }),
      input: {
        organizationId: ids.organization,
        connectorType: provider,
        approved: true,
        policy: defaultLiveSearchPolicy(),
      },
    })

  async function snapshot() {
    const [groups, servers, approvals, policies, organizations] = await Promise.all([
      db.select().from(credentialGroup).where(eq(credentialGroup.organizationId, ids.organization)),
      db.select().from(mcpServers).where(eq(mcpServers.organizationId, ids.organization)),
      db
        .select()
        .from(organizationSearchIntegration)
        .where(eq(organizationSearchIntegration.organizationId, ids.organization)),
      db.select().from(resourcePolicy).where(eq(resourcePolicy.organizationId, ids.organization)),
      db
        .select({ metadata: organization.metadata })
        .from(organization)
        .where(eq(organization.id, ids.organization)),
    ])
    return { groups, servers, approvals, policies, metadata: toRecord(organizations[0]?.metadata) }
  }

  it.each([
    ['fireflies', 'https://api.fireflies.ai/mcp'],
    ['granola', 'https://mcp.granola.ai/mcp'],
    ['notion', 'https://mcp.notion.com/mcp'],
  ])(
    'approves %s with an organization-owned sign-in server and access policy',
    async (provider, url) => {
      const result = await approve(provider)
      const state = await snapshot()
      expect(state.groups).toHaveLength(1)
      const group = state.groups[0]
      expect(group).toMatchObject({
        organizationId: ids.organization,
        workspaceId: null,
        status: 'active',
        createdBy: ids.owner,
      })
      expect(state.servers).toEqual([
        expect.objectContaining({
          credentialGroupId: group.id,
          organizationId: ids.organization,
          workspaceId: null,
          managedConnectorId: provider,
          url,
          enabled: true,
          authType: 'oauth',
          createdBy: ids.owner,
        }),
      ])
      expect(state.approvals).toEqual([
        expect.objectContaining({ connectorType: provider, approved: true }),
      ])
      expect(state.policies).toEqual([
        expect.objectContaining({
          resourceType: 'credential_group',
          resourceId: group.id,
          document: {
            version: 2,
            resource: { type: 'credential_group', id: group.id },
            statements: [],
          },
        }),
      ])
      expect(toRecord(state.metadata.liveSearchPolicies)[provider]).toMatchObject({
        accessMode: 'member',
      })
      expect(state.metadata.preserved).toBe('organization setting')
      expect(result.memberAccounts?.groupId).toBe(group.id)
    }
  )

  it('serializes concurrent approvals into one group and one server per provider', async () => {
    const providers = ['fireflies', 'granola', 'notion']
    const results = await Promise.all(
      [...providers, ...providers].map((provider) => approve(provider))
    )
    const state = await snapshot()
    expect(state.groups).toHaveLength(1)
    expect(state.servers).toHaveLength(3)
    expect(new Set(state.servers.map(({ managedConnectorId }) => managedConnectorId)).size).toBe(3)
    expect(
      state.servers.every(({ credentialGroupId }) => credentialGroupId === state.groups[0].id)
    ).toBe(true)
    expect(
      results.every(({ memberAccounts }) => memberAccounts?.groupId === state.groups[0].id)
    ).toBe(true)
    const serverIds = state.servers.map(({ id }) => id).sort()
    await Promise.all(providers.map((provider) => approve(provider)))
    expect((await snapshot()).servers.map(({ id }) => id).sort()).toEqual(serverIds)
  })

  it('refuses to reactivate a disabled connected-accounts group while approving Search', async () => {
    const group = await db.transaction((tx) =>
      createOrganizationAccountsGroup(tx, ids.organization, ids.owner)
    )
    await db
      .update(credentialGroup)
      .set({ status: 'disabled' })
      .where(eq(credentialGroup.id, group.id))
    const before = await snapshot()
    await expect(approve('fireflies')).rejects.toThrow(/disabled|enable/i)
    expect(await snapshot()).toEqual(before)
  })

  it('refuses to reactivate a disabled managed server while approving Search', async () => {
    const group = await db.transaction((tx) =>
      createOrganizationAccountsGroup(tx, ids.organization, ids.owner)
    )
    await db.insert(mcpServers).values({
      id: generateId(),
      organizationId: ids.organization,
      credentialGroupId: group.id,
      managedConnectorId: 'fireflies',
      name: 'Fireflies',
      transport: 'streamable-http',
      url: 'https://api.fireflies.ai/mcp',
      authType: 'oauth',
      enabled: false,
      createdBy: ids.owner,
    })
    const before = await snapshot()
    await expect(approve('fireflies')).rejects.toThrow(/disabled|enable/i)
    expect(await snapshot()).toEqual(before)
  })

  it.each(['member', 'outsider'] as const)(
    'denies a %s without creating approval or sign-in resources',
    async (actor) => {
      const before = await snapshot()
      await expect(approve('fireflies', ids[actor])).rejects.toMatchObject({
        code: actor === 'member' ? 'forbidden' : 'not_found',
      })
      expect(await snapshot()).toEqual(before)
    }
  )

  it('rolls back sign-in resources and policy metadata when the final approval write fails', async () => {
    const constraint = `search_setup_${generateId().replace(/-/g, '')}`
    await db.execute(
      sql`ALTER TABLE organization_search_integration ADD CONSTRAINT ${sql.identifier(constraint)} CHECK (organization_id <> ${sql.raw(`'${ids.organization}'`)}) NOT VALID`
    )
    const before = await snapshot()
    try {
      let failure: unknown
      try {
        await approve('fireflies')
      } catch (error) {
        failure = error
      }
      expect(getPostgresErrorCode(failure)).toBe('23514')
      expect(await snapshot()).toEqual(before)
    } finally {
      await db.execute(
        sql`ALTER TABLE organization_search_integration DROP CONSTRAINT ${sql.identifier(constraint)}`
      )
    }
  })
})
