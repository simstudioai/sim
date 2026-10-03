import { describe, expect, it } from 'vitest'
import { requireManagedMcpConnectorUrl } from '@/lib/credential-groups/managed-mcp-connectors'

describe('managed MCP connectors', () => {
  it('refuses a caller-supplied URL for fixed connectors', () => {
    expect(() => requireManagedMcpConnectorUrl('coda', 'https://example.com/mcp')).toThrow()
    expect(() => requireManagedMcpConnectorUrl('fireflies', 'https://example.com/mcp')).toThrow(
      'Fireflies uses the fixed MCP URL'
    )
  })

  it.each([
    'https://workspace.cloud.databricks.com/api/2.0/mcp/functions/catalog/schema',
    'https://workspace.azuredatabricks.net/api/2.0/mcp/vector-search/catalog/schema/index',
    'https://workspace.cloud.databricks.us/api/2.0/mcp/functions/catalog/schema',
    'https://example.databricksapps.com/mcp',
  ])('accepts an official Databricks MCP URL: %s', (url) => {
    expect(requireManagedMcpConnectorUrl('databricks', url)).toBe(url)
  })

  it.each([
    'http://workspace.cloud.databricks.com/api/2.0/mcp/functions/catalog/schema',
    'https://workspace.cloud.databricks.com/not-mcp',
    'https://databricks.example.com/api/2.0/mcp/functions/catalog/schema',
    'https://workspace.cloud.databricks.com/api/2.0/mcp/functions/catalog/schema?token=secret',
  ])('rejects a noncanonical Databricks MCP URL: %s', (url) => {
    expect(() => requireManagedMcpConnectorUrl('databricks', url)).toThrow()
  })
})
