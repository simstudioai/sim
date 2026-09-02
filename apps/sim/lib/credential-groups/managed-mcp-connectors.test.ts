/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  getManagedMcpConnector,
  requireManagedMcpConnectorUrl,
} from '@/lib/credential-groups/managed-mcp-connectors'

describe('managed MCP connectors', () => {
  it('uses immutable URLs for fixed connectors', () => {
    expect(requireManagedMcpConnectorUrl('fireflies')).toBe('https://api.fireflies.ai/mcp')
    expect(requireManagedMcpConnectorUrl('granola')).toBe('https://mcp.granola.ai/mcp')
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

  it('fails on connector IDs that are not in the registry', () => {
    expect(() => getManagedMcpConnector('custom')).toThrow(
      'Unsupported managed MCP connector: custom'
    )
  })
})
