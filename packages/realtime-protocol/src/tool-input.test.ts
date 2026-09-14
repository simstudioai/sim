import { describe, expect, it } from 'vitest'
import { getToolInputIdentity, isSameToolInputIdentity, isToolInputRefCurrent } from './tool-input'

describe('isToolInputRefCurrent', () => {
  const jira = { type: 'jira', operation: 'read-bulk', params: { manualProjectId: 'MAN' } }
  const wikipedia = { type: 'wikipedia', operation: 'wikipedia_search' }
  const toolRef = { subblockId: 'tools', toolIndex: 1, identity: getToolInputIdentity(jira) ?? {} }

  it('accepts a key while its position holds the same tool', () => {
    expect(isToolInputRefCurrent([wikipedia, jira], '1:agentToolUsageControl', toolRef)).toBe(true)
    expect(isToolInputRefCurrent(JSON.stringify([wikipedia, jira]), '1:projectId', toolRef)).toBe(
      true
    )
  })

  it('rejects a key whose tool moved or was removed', () => {
    expect(isToolInputRefCurrent([jira, wikipedia], '1:agentToolUsageControl', toolRef)).toBe(false)
    expect(isToolInputRefCurrent([wikipedia], '1:agentToolUsageControl', toolRef)).toBe(false)
    expect(isToolInputRefCurrent(undefined, '1:agentToolUsageControl', toolRef)).toBe(false)
  })

  it('rejects a key that points at a different position', () => {
    expect(isToolInputRefCurrent([wikipedia, jira], '0:agentToolUsageControl', toolRef)).toBe(false)
  })
})

describe('tool-input identity', () => {
  const jira = {
    type: 'jira',
    operation: 'read-bulk',
    params: { projectId: 'PROJ', manualProjectId: 'MANUAL' },
    usageControl: 'auto',
    isExpanded: true,
  }

  it('ignores param values, expansion, and Permission Mode', () => {
    const identity = getToolInputIdentity(jira)

    expect(identity).toEqual({ type: 'jira', operation: 'read-bulk' })
    expect(
      isSameToolInputIdentity(
        { ...jira, params: { manualProjectId: 'OTHER' }, usageControl: 'none', isExpanded: false },
        identity ?? {}
      )
    ).toBe(true)
  })

  it('distinguishes tools by operation and referenced tool', () => {
    const identity = getToolInputIdentity(jira) ?? {}

    expect(isSameToolInputIdentity({ ...jira, operation: 'write' }, identity)).toBe(false)
    expect(isSameToolInputIdentity({ type: 'wikipedia' }, identity)).toBe(false)
    expect(
      isSameToolInputIdentity(
        { type: 'custom-tool', customToolId: 'b' },
        getToolInputIdentity({ type: 'custom-tool', customToolId: 'a' }) ?? {}
      )
    ).toBe(false)
  })

  it('distinguishes MCP tools by server and tool name', () => {
    const tool = { type: 'mcp', toolId: 'mcp-1', params: { serverId: 's1', toolName: 'search' } }
    const identity = getToolInputIdentity(tool) ?? {}

    expect(identity).toEqual({
      type: 'mcp',
      toolId: 'mcp-1',
      'params.serverId': 's1',
      'params.toolName': 'search',
    })
    expect(
      isSameToolInputIdentity({ ...tool, params: { serverId: 's2', toolName: 'search' } }, identity)
    ).toBe(false)
  })

  it('treats a missing or malformed entry as a different tool', () => {
    const identity = getToolInputIdentity(jira) ?? {}

    expect(getToolInputIdentity(undefined)).toBeNull()
    expect(getToolInputIdentity({ operation: 'read-bulk' })).toBeNull()
    expect(isSameToolInputIdentity(undefined, identity)).toBe(false)
  })
})
