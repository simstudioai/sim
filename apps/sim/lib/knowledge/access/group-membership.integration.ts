import { drizzle } from 'drizzle-orm/postgres-js'
import type postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createEnterpriseSearchMigrationFixture } from '@/lib/knowledge/__integration__/migration-fixture'
import { parentGroupTokensQuery } from '@/lib/knowledge/access/group-membership'

describe('Confluence space audience access in PostgreSQL', () => {
  let fixture: Awaited<ReturnType<typeof createEnterpriseSearchMigrationFixture>>
  let client: ReturnType<typeof postgres>
  const cutoff = new Date('2026-09-17T00:00:00Z')
  const scope = { kind: 'organization', organizationId: 'org' } as const
  const token = (id: string) => `g:confluence:cloud:${id}`

  beforeAll(async () => {
    fixture = await createEnterpriseSearchMigrationFixture(
      process.env.KNOWLEDGE_ACL_TEST_DATABASE_URL!
    )
    client = fixture.client
    await fixture.migrate()
    await client`INSERT INTO organization(id) VALUES ('org'), ('other')`
    await client`INSERT INTO workspace(id) VALUES ('workspace')`
  })
  afterAll(async () => fixture?.cleanup())
  beforeEach(async () => {
    await client`DELETE FROM knowledge_external_group`
  })

  async function group(
    id: string,
    members: string[],
    options: {
      provider?: string
      tenant?: string
      organization?: string
      workspace?: string
      stale?: boolean
    } = {}
  ) {
    await client`INSERT INTO knowledge_external_group(id, organization_id, workspace_id, provider_id, tenant_id, external_group_id, last_synced_at)
      VALUES (${id}, ${options.workspace ? null : (options.organization ?? 'org')}, ${options.workspace ?? null},
        ${options.provider ?? 'confluence'}, ${options.tenant ?? 'cloud'}, ${id},
        ${options.stale ? '2026-09-16T00:00:00Z' : '2026-09-17T12:00:00Z'})`
    for (const member of members) {
      await client`INSERT INTO knowledge_external_group_member(group_id, subject_token) VALUES (${id}, ${member})`
    }
  }

  async function parents(seeds = [token('engineering')]) {
    const rows = await drizzle(client).execute<{ token: string }>(
      parentGroupTokensQuery(seeds, scope, cutoff)
    )
    return rows.map((row) => row.token).sort()
  }

  it('resolves one native-group hop without traversing arbitrary nested groups or cycles', async () => {
    await group('space-readers:1', [token('engineering'), token('cycle')])
    await group('cycle', [token('space-readers:1')])
    await group('space-readers:2', [token('space-readers:1')])
    expect(await parents()).toEqual([token('space-readers:1')])
    expect(await parents([token('space-readers:1')])).toEqual([])
  })

  it('rejects cross-owner, cross-provider, cross-tenant, and stale membership at every hop', async () => {
    await group('space-readers:1', [token('engineering')])
    await group('space-readers:2', [token('engineering')], { organization: 'other' })
    await group('space-readers:3', [token('engineering')], { workspace: 'workspace' })
    await group('space-readers:4', [token('engineering')], { provider: 'jira' })
    await group('space-readers:5', [token('engineering')], { tenant: 'other' })
    await group('space-readers:6', [token('engineering')], { stale: true })
    expect(await parents()).toEqual([token('space-readers:1')])
    expect(await parents([])).toEqual([])
  })

  it('handles more group seeds than PostgreSQL permits bind parameters', async () => {
    await group('space-readers:1', [token('group-69999')])
    const seeds = Array.from({ length: 70_000 }, (_, index) => token(`group-${index}`))
    expect(await parents(seeds)).toEqual([token('space-readers:1')])
  })
})
