/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/utils/urls', () => ({ getBaseUrl: () => 'https://sim.example' }))

import {
  bindOAuthIssuedResource,
  getOAuthIssuedResource,
  InvalidOAuthResourceError,
  oauthResourcePlugin,
  parseOAuthSearchResource,
  withOAuthResourceIssuance,
} from '@/lib/auth/oauth-resource'

const resource = 'https://sim.example/api/mcp/search/organizations/org-one'
const otherResource = 'https://sim.example/api/mcp/search/organizations/org-two'
const scopes = ['search:read', 'offline_access']

describe('OAuth resource binding', () => {
  it('accepts exact organization Search endpoints and an absent API audience', () => {
    expect(parseOAuthSearchResource(resource)).toBe(resource)
    expect(parseOAuthSearchResource(null)).toBeNull()
  })

  it.each([
    '',
    'https://sim.example/api/mcp/search/workspace-one',
    'https://sim.example/api/mcp/search/workspace-one?organizationId=org-one',
    'https://attacker.example/api/mcp/search/organizations/org-one',
    'http://sim.example/api/mcp/search/organizations/org-one',
    'https://user@sim.example/api/mcp/search/organizations/org-one',
    'https://sim.example/api/mcp/search/organizations/org-one?scope=other',
    'https://sim.example/api/mcp/search/organizations/org-one#fragment',
    'https://sim.example/api/mcp/search/organizations/org-one/',
    'https://sim.example/api/mcp/search/organizations/%6frg-one',
    'https://sim.example/api/mcp/search/organizations/a/../org-one',
    'https://sim.example/api/mcp/search/organizations',
    'https://sim.example/api/v2/workspaces',
    'https://sim.example:443/api/mcp/search/organizations/org-one',
  ])('rejects noncanonical or unsupported resources: %s', (value) => {
    expect(() => parseOAuthSearchResource(value)).toThrow(InvalidOAuthResourceError)
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
  ])(
    'requires search scope and resource together without wider API authority',
    async (target, granted) => {
      await expect(
        withOAuthResourceIssuance(target, async () =>
          bindOAuthIssuedResource({
            verificationValue: { query: { resource: target ?? undefined } },
            scopes: granted,
          })
        )
      ).rejects.toMatchObject({ body: { error: 'invalid_scope' } })
    }
  )

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
