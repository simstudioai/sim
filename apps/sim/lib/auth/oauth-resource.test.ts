import { resetUrlsMock, urlsMockFns } from '@sim/testing/mocks/urls.mock'
import { afterAll, describe, expect, it } from 'vitest'
import {
  bindOAuthIssuedResource,
  getOAuthIssuedResource,
  InvalidOAuthResourceError,
  oauthResourcePlugin,
  parseOAuthResource,
  withOAuthResourceIssuance,
} from '@/lib/auth/oauth-resource'

urlsMockFns.mockGetBaseUrl.mockReturnValue('https://sim.example')
afterAll(resetUrlsMock)

const resource = 'https://sim.example/api/mcp/search/organizations/org-one'
const simMcpResource = 'https://sim.example/api/mcp'
const otherResource = 'https://sim.example/api/mcp/search/organizations/org-two'
const workflowMcpResource = 'https://sim.example/api/mcp/serve/server-one'
const scopes = ['search:read', 'offline_access']

describe('OAuth resource binding', () => {
  it('accepts exact organization Search endpoints, the Sim MCP server, and an absent API audience', () => {
    expect(parseOAuthResource(resource)).toEqual({ kind: 'search', url: resource })
    expect(parseOAuthResource(simMcpResource)).toEqual({ kind: 'api', url: simMcpResource })
    expect(parseOAuthResource(null)).toBeNull()
  })

  it('accepts exact workflow MCP server endpoints as Sim API audiences', () => {
    expect(parseOAuthResource(workflowMcpResource)).toEqual({
      kind: 'api',
      url: workflowMcpResource,
    })
  })

  it.each([
    '',
    'https://sim.example/api/mcp/search/workspace-one',
    'https://attacker.example/api/mcp/search/organizations/org-one',
    'http://sim.example/api/mcp/search/organizations/org-one',
    'https://user@sim.example/api/mcp/search/organizations/org-one',
    'https://sim.example/api/mcp/search/organizations/org-one?scope=other',
    'https://sim.example/api/mcp/search/organizations/org-one#fragment',
    'https://sim.example/api/mcp/search/organizations/org-one/',
    'https://sim.example/api/mcp/search/organizations/%6frg-one',
    'https://sim.example/api/mcp/search/organizations/a/../org-one',
    'https://sim.example:443/api/mcp/search/organizations/org-one',
    'https://sim.example/api/mcp/serve',
    'https://sim.example/api/mcp/serve/server-one/',
  ])('rejects noncanonical or unsupported resources: %s', (value) => {
    expect(() => parseOAuthResource(value)).toThrow(InvalidOAuthResourceError)
  })

  it('binds only the resource from the verified authorization request before insertion', async () => {
    await withOAuthResourceIssuance(resource, async () => {
      expect(() => getOAuthIssuedResource(scopes)).toThrow()
      expect(
        bindOAuthIssuedResource({ verificationValue: { query: { resource } }, scopes })
      ).toEqual({})
      expect(getOAuthIssuedResource(scopes)).toBe(resource)
    })
    expect(() => getOAuthIssuedResource(scopes)).toThrow()
  })

  it('refuses a previously issued code for a removed workspace Search resource', async () => {
    const removedResource = 'https://sim.example/api/mcp/search/workspace-one'
    await expect(
      withOAuthResourceIssuance(removedResource, async () =>
        bindOAuthIssuedResource({
          verificationValue: { query: { resource: removedResource } },
          scopes,
        })
      )
    ).rejects.toMatchObject({ body: { error: 'invalid_target' } })
  })

  it.each([
    [resource, otherResource],
    [resource, undefined],
    [null, resource],
  ])('refuses code/token resource substitution or omission', async (requested, authorized) => {
    await expect(
      withOAuthResourceIssuance(requested, async () =>
        bindOAuthIssuedResource({ verificationValue: { query: { resource: authorized } }, scopes })
      )
    ).rejects.toMatchObject({ body: { error: 'invalid_target' } })
  })

  it.each([
    [resource, ['api:read']],
    [resource, ['search:read', 'api:read']],
    [null, ['search:read']],
    [simMcpResource, ['search:read']],
    [simMcpResource, ['api:write', 'search:read']],
    [simMcpResource, ['offline_access']],
  ])('grants each resource only its own scope family: %s %j', async (target, granted) => {
    await expect(
      withOAuthResourceIssuance(target, async () =>
        bindOAuthIssuedResource({
          verificationValue: { query: { resource: target ?? undefined } },
          scopes: granted,
        })
      )
    ).rejects.toMatchObject({ body: { error: 'invalid_scope' } })
  })

  it('binds Sim API grants to the Sim MCP server', async () => {
    const apiScopes = ['api:write', 'offline_access']
    await withOAuthResourceIssuance(simMcpResource, async () => {
      expect(
        bindOAuthIssuedResource({
          verificationValue: { query: { resource: simMcpResource } },
          scopes: apiScopes,
        })
      ).toEqual({})
      expect(getOAuthIssuedResource(apiScopes)).toBe(simMcpResource)
    })
  })

  it('preserves existing API issuance and refuses direct Search provider calls', async () => {
    expect(bindOAuthIssuedResource({ scopes: ['api:read'] })).toEqual({})
    expect(getOAuthIssuedResource(['api:read'])).toBeNull()
    expect(() =>
      bindOAuthIssuedResource({ verificationValue: { query: { resource } }, scopes })
    ).toThrow()
  })

  it('isolates overlapping token requests', async () => {
    const results = await Promise.all(
      [resource, otherResource].map((target) =>
        withOAuthResourceIssuance(target, async () => {
          bindOAuthIssuedResource({ verificationValue: { query: { resource: target } }, scopes })
          await Promise.resolve()
          return getOAuthIssuedResource(scopes)
        })
      )
    )
    expect(results).toEqual([resource, otherResource])
  })

  it('makes resource fields server-owned and absent from public provider responses', () => {
    const plugin = oauthResourcePlugin()
    for (const model of Object.values(plugin.schema)) {
      expect(model.fields.resource).toEqual({
        type: 'string',
        required: false,
        input: false,
        returned: false,
      })
    }
  })
})
