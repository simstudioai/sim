/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { discover, discoverManaged } = vi.hoisted(() => ({
  discover: vi.fn(),
  discoverManaged: vi.fn(),
}))
vi.mock('@/lib/credentials/application/discover-managed-mcp-tools', () => ({
  discoverManagedMcpToolsUseCase: { execute: discoverManaged },
}))
vi.mock('@/lib/mcp/application/use-cases', () => ({
  discoverMcpServerToolsUseCase: { execute: discover },
}))

import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import { mcpSelectorAttachments } from '@/lib/selectors/server/providers/mcp'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'

function args(request: ExecuteServerSelectorArgs['request']): ExecuteServerSelectorArgs {
  return {
    selectorKey: 'mcp.tools',
    context: { mcpServerId: 'destination-server' },
    request,
    scope: { kind: 'workspace', workspaceId: 'destination' },
    workspaceId: 'destination',
    principal: { kind: 'personal_api_key', userId: 'user', keyId: 'key' },
    requesterUserId: 'user',
    references: new Map(),
    protectedValues: createSelectorProtectedValues(),
    signal: new AbortController().signal,
  }
}
async function execute(input: ExecuteServerSelectorArgs) {
  const attachment = mcpSelectorAttachments['mcp.tools']
  if (attachment.destination === 'fixed') throw new Error('Expected bound MCP destination')
  return attachment.execute(input, await attachment.destination.prepare(input))
}
describe('MCP tools selector', () => {
  beforeEach(() => vi.clearAllMocks())
  it('uses authorized discovery, projects names only, and pages the complete inventory', async () => {
    discover.mockResolvedValue({
      tools: Array.from({ length: 101 }, (_, i) => ({
        name: `tool-${String(i).padStart(3, '0')}`,
        description: 'not public selector metadata',
        inputSchema: { secret: 'never project' },
      })),
    })
    const input = args({ kind: 'list' })
    const first = await execute(input)
    expect(discover).toHaveBeenCalledWith({
      principal: input.principal,
      input: {
        workspaceId: 'destination',
        serverId: 'destination-server',
        signal: input.signal,
        requireComplete: true,
      },
    })
    expect(first).toMatchObject({ kind: 'list', nextCursor: '100' })
    if (first.kind !== 'list') throw new Error('Expected list')
    expect(first.items).toHaveLength(100)
    expect(first.items[0]).toEqual({ id: 'tool-000', label: 'tool-000' })
    expect(await execute(args({ kind: 'list', cursor: '100' }))).toEqual({
      kind: 'list',
      items: [{ id: 'tool-100', label: 'tool-100' }],
    })
  })
  it('verifies actual tool names and propagates authorization refusal', async () => {
    discover.mockResolvedValueOnce({ tools: [{ name: 'available' }] })
    expect(await execute(args({ kind: 'detail', id: 'missing' }))).toEqual({
      kind: 'detail',
      item: null,
    })
    discover.mockRejectedValueOnce(new Error('Destination access denied'))
    await expect(execute(args({ kind: 'list' }))).rejects.toThrow('Destination access denied')
  })
  it('discovers a managed connection through its authorized use case with the acting principal', async () => {
    discoverManaged.mockResolvedValue({ tools: [{ name: 'read', canonicalServerId: 'parent' }] })
    const input = args({ kind: 'list' })
    input.context.mcpServerId = 'mcp-cg-abcdefghijklmnopqrstu'
    expect(await execute(input)).toEqual({
      kind: 'list',
      items: [{ id: 'read', label: 'read' }],
    })
    expect(discoverManaged).toHaveBeenCalledWith({
      principal: input.principal,
      input: {
        workspaceId: 'destination',
        credentialId: 'mcp-cg-abcdefghijklmnopqrstu',
        signal: input.signal,
      },
    })
    expect(discover).not.toHaveBeenCalled()
    discoverManaged.mockRejectedValueOnce(new Error('Credential revoked'))
    await expect(execute(input)).rejects.toThrow('Credential revoked')
    expect(discover).not.toHaveBeenCalled()
  })
})
