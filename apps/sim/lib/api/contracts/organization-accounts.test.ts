/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { addOrganizationAccountMcpProviderContract } from '@/lib/api/contracts/organization-accounts'

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
