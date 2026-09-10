/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import {
  type McpOperationPolicy,
  normalizeMcpOperationPolicy,
  permitsMcpOperation,
} from '@/lib/mcp/operation-policy'

const selected = ['read']
const tools = [{ name: 'read' }, { name: 'write' }, { name: 'new_tool' }]

describe('MCP operation policies', () => {
  it.each<[McpOperationPolicy, string[]]>([
    [{ mode: 'all' }, ['read', 'write', 'new_tool']],
    [{ mode: 'allow', operations: [] }, []],
    [{ mode: 'deny', operations: [] }, ['read', 'write', 'new_tool']],
    [{ mode: 'allow', operations: selected }, ['read']],
    [{ mode: 'deny', operations: selected }, ['write', 'new_tool']],
  ])('evaluates %j including new operations', (policy, expected) => {
    expect(
      tools.filter((tool) => permitsMcpOperation(policy, tool.name)).map((tool) => tool.name)
    ).toEqual(expected)
  })

  it('uses exact, case-sensitive MCP tool names without a server prefix', () => {
    const policy: McpOperationPolicy = { mode: 'allow', operations: selected }
    expect(permitsMcpOperation(policy, 'read')).toBe(true)
    expect(permitsMcpOperation(policy, 'server-a-read')).toBe(false)
    expect(permitsMcpOperation(policy, 'Read')).toBe(false)
    expect(permitsMcpOperation(policy, 'read_more')).toBe(false)
  })

  it('retains an absent denied operation so it stays denied when it returns', () => {
    const policy = normalizeMcpOperationPolicy({ mode: 'deny', operations: selected })
    expect([{ name: 'write' }].filter((tool) => permitsMcpOperation(policy, tool.name))).toEqual([
      { name: 'write' },
    ])
    expect(tools.filter((tool) => permitsMcpOperation(policy, tool.name))).not.toContainEqual({
      name: 'read',
    })
    expect(policy).toEqual({ mode: 'deny', operations: selected })
  })

  it.each([undefined, null])('normalizes saved pre-policy configuration %j to all', (value) => {
    expect(normalizeMcpOperationPolicy(value)).toEqual({ mode: 'all' })
  })

  it.each([
    {},
    '',
    '<upstream.policy>',
    { mode: 'all', operations: [] },
    { mode: 'allow' },
    { mode: 'deny', operations: [''] },
    { mode: 'allow', operations: ['<upstream.tool>'] },
    { mode: 'allow', operations: ['{{tool}}'] },
    { mode: 'allow', operations: [' read'] },
    { mode: 'allow', operations: ['x'.repeat(257)] },
    { mode: 'deny', operations: Array(1001).fill('read') },
    { mode: 'allow', operations: ['read', { serverId: 'server-a', name: 'write' }] },
    { mode: 'allow', operations: [{ serverId: '', name: 'read' }] },
  ])('rejects invalid policy %j', (policy) => {
    expect(() => normalizeMcpOperationPolicy(policy)).toThrow(
      'Invalid MCP operations access policy'
    )
  })

  it.each(['allow', 'deny'])('normalizes interim %s entries to unique tool names', (mode) => {
    expect(
      normalizeMcpOperationPolicy({
        mode,
        operations: [
          { serverId: 'server-a', name: 'read' },
          { serverId: 'server-b', name: 'read' },
          { serverId: 'server-b', name: 'write' },
        ],
      })
    ).toEqual({ mode, operations: ['read', 'write'] })
  })
})
