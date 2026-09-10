/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import {
  type McpOperationPolicy,
  normalizeMcpOperationPolicy,
  permitsMcpOperation,
} from '@/lib/mcp/operation-policy'

const selected = [{ serverId: 'server-a', name: 'read' }]
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
      tools
        .filter((tool) => permitsMcpOperation(policy, 'server-a', tool.name))
        .map((tool) => tool.name)
    ).toEqual(expected)
  })

  it('uses exact, case-sensitive names on the canonical server', () => {
    const policy: McpOperationPolicy = { mode: 'allow', operations: selected }
    expect(permitsMcpOperation(policy, 'server-b', 'read')).toBe(false)
    expect(permitsMcpOperation(policy, 'credential-a', 'read')).toBe(false)
    expect(permitsMcpOperation(policy, 'server-a', 'Read')).toBe(false)
    expect(permitsMcpOperation(policy, 'server-a', 'read_more')).toBe(false)
  })

  it('retains an absent denied operation so it stays denied when it returns', () => {
    const policy = normalizeMcpOperationPolicy({ mode: 'deny', operations: selected })
    expect(
      [{ name: 'write' }].filter((tool) => permitsMcpOperation(policy, 'server-a', tool.name))
    ).toEqual([{ name: 'write' }])
    expect(
      tools.filter((tool) => permitsMcpOperation(policy, 'server-a', tool.name))
    ).not.toContainEqual({ name: 'read' })
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
    { mode: 'deny', operations: ['read'] },
    { mode: 'allow', operations: [{ serverId: '', name: 'read' }] },
  ])('rejects invalid policy %j', (policy) => {
    expect(() => normalizeMcpOperationPolicy(policy)).toThrow(
      'Invalid MCP operations access policy'
    )
  })
})
