import { describe, expect, it } from 'vitest'
import { readHubSpotMcp, searchHubSpotMcp } from '@/lib/sim-search/live/hubspot-mcp'
import type { ManagedSearchMcpClient } from '@/lib/sim-search/live/managed-mcp'

const ACCOUNT = 12345
const permissions = {
  accountId: ACCOUNT,
  toolInformation: {
    crmObjectTypeAvailability: {
      CONTACT: { read: 'AVAILABLE' },
      COMPANY: { read: 'AVAILABLE' },
      DEAL: { read: 'AVAILABLE' },
      TICKET: { read: 'AVAILABLE' },
    },
  },
}
const url = `https://app.hubspot.com/contacts/${ACCOUNT}/record/0-1/42`
const row = {
  id: 42,
  displayName: 'Fixture contact',
  properties: { firstname: 'Fixture', lastmodifieddate: '2026-09-01T12:00:00Z' },
}
const page = { results: [row], total: 1, offset: 1, urlTemplate: url.replace('/42', '/{id}') }
const input = {
  query: 'Fixture',
  limit: 10,
  scopes: [],
  native: { provider: 'hubspot' as const, kind: 'contacts' as const, query: 'Fixture' },
}
const fixture = (responses: Record<string, unknown>): ManagedSearchMcpClient => ({
  async call(name) {
    if (name === 'get_user_details') return permissions
    if (!(name in responses)) throw new Error('Unexpected HubSpot operation')
    return responses[name]
  },
})

describe('HubSpot member CRM boundary', () => {
  it('fails closed on missing permission metadata and surfaces scope reauthorization', async () => {
    for (const details of [
      { accountId: ACCOUNT },
      {
        ...permissions,
        toolInformation: {
          crmObjectTypeAvailability: { CONTACT: { read: 'REQUIRES_REAUTHORIZATION' } },
        },
      },
    ]) {
      const client: ManagedSearchMcpClient = {
        call: async (name) => (name === 'get_user_details' ? details : page),
      }
      await expect(searchHubSpotMcp(client, input)).rejects.toMatchObject({
        status: 'toolInformation' in details ? 'reconnect' : 'unavailable',
      })
    }
  })
  it('rejects foreign-account, wrong-kind, and attacker-origin result links instead of emitting trusted references', async () => {
    for (const template of [
      page.urlTemplate.replace(String(ACCOUNT), '99999'),
      page.urlTemplate.replace('/0-1/', '/0-2/'),
      page.urlTemplate.replace('app.hubspot.com', 'attacker.example'),
    ]) {
      const result = await searchHubSpotMcp(
        fixture({ search_crm_objects: { ...page, urlTemplate: template } }),
        input
      )
      expect(result.documents).toEqual([])
      expect(result.partial).toBe(true)
    }
  })
  it('does not round unsafe numeric record IDs into another record', async () => {
    const result = await searchHubSpotMcp(
      fixture({
        search_crm_objects: { ...page, results: [{ ...row, id: Number.MAX_SAFE_INTEGER + 1 }] },
      }),
      input
    )
    expect(result.documents).toEqual([])
    expect(result.partial).toBe(true)
  })
  it('requires a supported search envelope instead of reporting schema drift as zero matches', async () => {
    for (const invalid of [{}, { results: null }, { ...page, total: -1 }, { ...page, offset: 0 }])
      await expect(
        searchHubSpotMcp(fixture({ search_crm_objects: invalid }), input)
      ).rejects.toThrow()
  })
  it('continues a typed page only when the provider reports more matches', async () => {
    const first = await searchHubSpotMcp(fixture({ search_crm_objects: { ...page, total: 2 } }), {
      ...input,
      limit: 1,
    })
    expect(first.nextCursor).toBe('1')
    const last = await searchHubSpotMcp(
      fixture({
        search_crm_objects: { ...page, total: 2, offset: 2, results: [{ ...row, id: 43 }] },
      }),
      { ...input, limit: 1, native: { ...input.native, cursor: first.nextCursor } }
    )
    expect(last.nextCursor).toBeUndefined()
    expect(last.documents).toHaveLength(1)
    await expect(
      searchHubSpotMcp(fixture({ search_crm_objects: { ...page, total: 2 } }), {
        ...input,
        native: { ...input.native, cursor: '1' },
      })
    ).rejects.toThrow()
  })
  it('preserves valid collection results with explicit partial coverage when another collection fails', async () => {
    const client: ManagedSearchMcpClient = {
      async call(name, args) {
        if (name === 'get_user_details') return permissions
        if (name === 'search_crm_objects' && args.objectType === 'CONTACT') return page
        throw new Error('Collection unavailable')
      },
    }
    const result = await searchHubSpotMcp(client, { query: 'Fixture', limit: 10, scopes: [] })
    expect(result.documents).toHaveLength(1)
    expect(result.partial).toBe(true)
  })
  it('reads only the exact returned record and refuses a changed account or mismatched record', async () => {
    const search = await searchHubSpotMcp(fixture({ search_crm_objects: page }), input)
    const id = search.documents[0].id
    const valid = { ...row, url, archived: false, updatedAt: '2026-09-02T12:00:00Z' }
    const result = await readHubSpotMcp(
      fixture({ get_crm_objects: { objects: [valid], notFound: [] } }),
      id
    )
    expect(Date.parse(result.modifiedAt!)).toBe(Date.parse(valid.updatedAt))
    for (const replacement of [
      { ...valid, id: 43 },
      { ...valid, archived: true },
      { ...valid, url: url.replace('/42', '/43') },
    ])
      await expect(
        readHubSpotMcp(fixture({ get_crm_objects: { objects: [replacement], notFound: [] } }), id)
      ).rejects.toThrow()
    const otherAccount: ManagedSearchMcpClient = {
      call: async () => ({ ...permissions, accountId: 99999 }),
    }
    await expect(readHubSpotMcp(otherAccount, id)).rejects.toThrow()
  })
  it('marks oversized record content instead of silently returning a complete-looking read', async () => {
    const search = await searchHubSpotMcp(fixture({ search_crm_objects: page }), input)
    const result = await readHubSpotMcp(
      fixture({
        get_crm_objects: {
          objects: [{ ...row, url, properties: { description: 'x'.repeat(220_000) } }],
          notFound: [],
        },
      }),
      search.documents[0].id
    )
    expect(result.content.length).toBeLessThanOrEqual(200_000)
    expect(result.content).toMatch(/truncated/i)
  })
})
