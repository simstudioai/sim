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
