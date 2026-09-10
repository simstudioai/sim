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
  it('offers one canonical server and each explicit managed connection', () => {
    expect(
      getMcpTargetOptions([server, { ...server, id: 'mcp-cg-two' }], 'server').map(
        (option) => option.value
      )
    ).toEqual(['canonical-1', 'mcp-cg-one', 'mcp-cg-two'])
  })
  it('offers only connections belonging to the selected canonical server', () => {
    const servers = [server, { ...server, id: 'mcp-cg-other', canonicalServerId: 'canonical-2' }]
    expect(
      getMcpTargetOptions(servers, 'connection', 'canonical-1').map((option) => option.value)
    ).toEqual(['mcp-cg-one'])
    expect(getMcpTargetOptions(servers, 'connection', '<upstream.server>')).toHaveLength(2)
    expect(getMcpTargetOptions([{ ...server, enabled: false }], 'connection')).toEqual([])
  })
})
