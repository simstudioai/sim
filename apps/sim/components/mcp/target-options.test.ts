/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { getMcpTargetOptions } from '@/components/mcp/target-options'
import type { McpServer } from '@/lib/api/contracts/mcp'

const server: McpServer = {
  id: 'mcp-cg-one',
  name: 'Fireflies — person@example.com',
  canonicalServerId: 'canonical-1',
  canonicalServerName: 'Fireflies',
  workspaceId: 'workspace-1',
  transport: 'streamable-http',
  enabled: true,
  createdAt: '2026-09-01',
  updatedAt: '2026-09-01',
}

describe('MCP configured targets', () => {
  it('offers executable account connections without their non-executable parent', () => {
    expect(
      getMcpTargetOptions([server, { ...server, id: 'mcp-cg-two' }]).map((option) => option.value)
    ).toEqual(['mcp-cg-one', 'mcp-cg-two'])
    expect(getMcpTargetOptions([server])[0].label).toBe(server.name)
  })
  it('includes shared servers and excludes disabled or deleted connections', () => {
    const shared = { ...server, id: 'shared', name: 'Shared', canonicalServerId: undefined }
    expect(
      getMcpTargetOptions([
        shared,
        { ...server, enabled: false },
        { ...server, deletedAt: '2026-09-01' },
      ]).map((option) => option.value)
    ).toEqual(['shared'])
  })
})
