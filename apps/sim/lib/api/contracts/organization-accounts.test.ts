/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import {
  addOrganizationAccountMcpProviderContract,
  listOrganizationAccountPeopleContract,
  reconnectPersonalOrganizationAccountContract,
  startOrganizationAccountConnectionContract,
} from '@/lib/api/contracts/organization-accounts'

describe.each([
  startOrganizationAccountConnectionContract,
  reconnectPersonalOrganizationAccountContract,
])('account connection response $path', (contract) => {
  const invitationLink = 'https://sim.test/credential-groups/enroll/fixture-token'
  const authorizationUrl =
    'https://sim.test/api/credential-groups/enroll/fixture-token/oauth/option-1?returnTo=search'

  it('accepts older enrollment-only responses and the additive direct OAuth URL', () => {
    expect(contract.response.schema.parse({ invitationLink })).toEqual({ invitationLink })
    expect(contract.response.schema.parse({ invitationLink, authorizationUrl })).toEqual({
      invitationLink,
      authorizationUrl,
    })
  })

  it('rejects malformed or oversized direct URLs', () => {
    expect(
      contract.response.schema.safeParse({ invitationLink, authorizationUrl: '/relative' }).success
    ).toBe(false)
    expect(
      contract.response.schema.safeParse({
        invitationLink,
        authorizationUrl: `https://sim.test/${'x'.repeat(8192)}`,
      }).success
    ).toBe(false)
  })
})

describe('organization MCP provider creation contract', () => {
  const schema = addOrganizationAccountMcpProviderContract.body
  if (!schema) throw new Error('MCP provider creation requires a body contract')
  const databricks = {
    connectorId: 'databricks',
    name: 'Databricks',
    url: 'https://tenant.cloud.databricks.com/api/2.0/mcp/sql',
    oauthClientId: 'client-1',
  }

  it.each(['fireflies', 'granola'])(
    'allows adding %s without tenant configuration',
    (connectorId) => {
      expect(schema.parse({ connectorId })).toEqual({ connectorId })
    }
  )

  it('requires configuration when adding Databricks', () => {
    expect(schema.safeParse({ connectorId: 'databricks' }).success).toBe(false)
    expect(schema.parse(databricks)).toEqual(databricks)
  })

  it.each(['name', 'url', 'oauthClientId'])('rejects missing or blank %s', (field) => {
    expect(schema.safeParse({ ...databricks, [field]: undefined }).success).toBe(false)
    expect(schema.safeParse({ ...databricks, [field]: '  ' }).success).toBe(false)
  })

  it('accepts an optional client secret while rejecting a caller-supplied workspace scope', () => {
    expect(schema.parse({ ...databricks, oauthClientSecret: 'secret-1' })).toHaveProperty(
      'oauthClientSecret',
      'secret-1'
    )
    expect(schema.safeParse({ ...databricks, workspaceId: 'workspace-1' }).success).toBe(false)
  })
})

describe('organization account people search contract', () => {
  const schema = listOrganizationAccountPeopleContract.query!

  it('adds trimmed substring search while preserving exact email and cursor inputs', () => {
    expect(
      schema.parse({ search: ' Example ', email: ' alex@example.com ', cursor: 'cursor-1' })
    ).toEqual({
      limit: 50,
      search: 'Example',
      email: 'alex@example.com',
      cursor: 'cursor-1',
    })
    expect(schema.parse({})).toEqual({ limit: 50 })
  })

  it('bounds search text and every response page', () => {
    expect(schema.safeParse({ search: 'x'.repeat(321) }).success).toBe(false)
    expect(schema.safeParse({ limit: 101 }).success).toBe(false)
    expect(schema.safeParse({ search: 'x'.repeat(320), limit: 100 }).success).toBe(true)
  })
})
