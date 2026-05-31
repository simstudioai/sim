/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { ContentBlock } from '../../types'
import { parseBlocks } from './message-content'

function subagentStart(name: string, spanId: string, parentSpanId: string): ContentBlock {
  return { type: 'subagent', content: name, spanId, parentSpanId, timestamp: 1 }
}

function subagentToolCall(
  id: string,
  name: string,
  spanId: string,
  calledBy: string
): ContentBlock {
  return {
    type: 'tool_call',
    toolCall: { id, name, status: 'success', calledBy },
    spanId,
    timestamp: 1,
  }
}

describe('parseBlocks span-identity tree', () => {
  it('nests a deploy subagent inside the workflow subagent that spawned it', () => {
    const blocks: ContentBlock[] = [
      subagentStart('workflow', 'S1', 'main'),
      subagentToolCall('t1', 'create_workflow', 'S1', 'workflow'),
      subagentStart('deploy', 'S2', 'S1'),
      subagentToolCall('t2', 'check_deployment_status', 'S2', 'deploy'),
    ]

    const segments = parseBlocks(blocks)

    expect(segments).toHaveLength(1)
    const workflow = segments[0]
    expect(workflow.type).toBe('agent_group')
    if (workflow.type !== 'agent_group') throw new Error('expected workflow group')
    expect(workflow.agentName).toBe('workflow')

    const nested = workflow.items.find((item) => item.type === 'agent_group')
    expect(nested).toBeDefined()
    if (!nested || nested.type !== 'agent_group') throw new Error('expected nested deploy group')
    expect(nested.group.agentName).toBe('deploy')
    // Deploy's own tool nests under deploy, not under workflow.
    expect(nested.group.items.some((item) => item.type === 'tool')).toBe(true)
  })

  it('keeps two top-level subagents as siblings', () => {
    const blocks: ContentBlock[] = [
      subagentStart('workflow', 'S1', 'main'),
      subagentStart('research', 'S3', 'main'),
    ]

    const segments = parseBlocks(blocks)
    const groups = segments.filter((s) => s.type === 'agent_group')
    expect(groups).toHaveLength(2)
  })

  it('creates distinct groups for repeated deploy invocations (no collision)', () => {
    const blocks: ContentBlock[] = [
      subagentStart('deploy', 'S2', 'main'),
      subagentToolCall('t1', 'deploy_api', 'S2', 'deploy'),
      subagentStart('deploy', 'S4', 'main'),
      subagentToolCall('t2', 'deploy_api', 'S4', 'deploy'),
    ]

    const segments = parseBlocks(blocks)
    const groups = segments.filter((s) => s.type === 'agent_group')
    expect(groups).toHaveLength(2)
  })

  it('shows the delegating spinner while a span subagent is open with no output, and clears it once content arrives', () => {
    const openOnly = parseBlocks([subagentStart('deploy', 'S2', 'main')])
    expect(openOnly).toHaveLength(1)
    if (openOnly[0].type !== 'agent_group') throw new Error('expected group')
    expect(openOnly[0].isDelegating).toBe(true)

    const withContent = parseBlocks([
      subagentStart('deploy', 'S2', 'main'),
      { type: 'subagent_text', content: 'working on it', spanId: 'S2', timestamp: 2 },
    ])
    if (withContent[0].type !== 'agent_group') throw new Error('expected group')
    expect(withContent[0].isDelegating).toBe(false)
  })

  it('prunes an empty nested subagent that started and ended without output', () => {
    const blocks: ContentBlock[] = [
      subagentStart('workflow', 'S1', 'main'),
      subagentToolCall('t1', 'create_workflow', 'S1', 'workflow'),
      subagentStart('deploy', 'S2', 'S1'),
      { type: 'subagent_end', spanId: 'S2', parentSpanId: 'S1', timestamp: 3 },
    ]
    const segments = parseBlocks(blocks)
    expect(segments).toHaveLength(1)
    if (segments[0].type !== 'agent_group') throw new Error('expected workflow group')
    // The empty, ended deploy group is pruned; only the workflow tool remains.
    expect(segments[0].items.some((item) => item.type === 'agent_group')).toBe(false)
    expect(segments[0].items.some((item) => item.type === 'tool')).toBe(true)
  })

  it('falls back to legacy flat grouping when blocks have no span identity', () => {
    const blocks: ContentBlock[] = [
      { type: 'subagent', content: 'workflow', parentToolCallId: 'tc-1', timestamp: 1 },
      {
        type: 'tool_call',
        toolCall: { id: 't1', name: 'create_workflow', status: 'success', calledBy: 'workflow' },
        parentToolCallId: 'tc-1',
        timestamp: 1,
      },
    ]

    const segments = parseBlocks(blocks)
    const groups = segments.filter((s) => s.type === 'agent_group')
    expect(groups).toHaveLength(1)
    if (groups[0].type !== 'agent_group') throw new Error('expected group')
    expect(groups[0].agentName).toBe('workflow')
  })
})
