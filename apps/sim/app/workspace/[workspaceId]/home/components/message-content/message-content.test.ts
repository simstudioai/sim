/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { ContentBlock } from '../../types'
import { parseBlocks, shouldSmoothTextSegment } from './message-content'

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

function mainText(content: string): ContentBlock {
  return { type: 'text', content, timestamp: 1 }
}

function mainToolCall(id: string, name: string): ContentBlock {
  return { type: 'tool_call', toolCall: { id, name, status: 'success' }, timestamp: 1 }
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

  it('clears the parent delegating flag once it has spawned a child, leaving only the child active', () => {
    const blocks: ContentBlock[] = [
      subagentStart('workflow', 'S1', 'main'),
      subagentStart('deploy', 'S2', 'S1'),
    ]

    const segments = parseBlocks(blocks)
    expect(segments).toHaveLength(1)
    const workflow = segments[0]
    if (workflow.type !== 'agent_group') throw new Error('expected workflow group')
    expect(workflow.isDelegating).toBe(false)

    const nested = workflow.items.find((item) => item.type === 'agent_group')
    if (!nested || nested.type !== 'agent_group') throw new Error('expected nested deploy group')
    expect(nested.group.isDelegating).toBe(true)
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

  it('keeps two concurrently-open subagent lanes separate with interleaved text', () => {
    const blocks: ContentBlock[] = [
      subagentStart('research', 'A', 'main'),
      subagentStart('research', 'B', 'main'),
      { type: 'subagent_text', content: 'A1 ', spanId: 'A', subagent: 'research', timestamp: 2 },
      { type: 'subagent_text', content: 'B1 ', spanId: 'B', subagent: 'research', timestamp: 2 },
      { type: 'subagent_text', content: 'A2', spanId: 'A', subagent: 'research', timestamp: 3 },
    ]

    const segments = parseBlocks(blocks)
    const groups = segments.filter((s) => s.type === 'agent_group')
    expect(groups).toHaveLength(2)

    const textOf = (g: (typeof groups)[number]): string => {
      if (g.type !== 'agent_group') return ''
      return g.items
        .filter((i) => i.type === 'text')
        .map((i) => (i.type === 'text' ? i.content : ''))
        .join('')
    }
    // Group A (spanId A) created first, group B second. Interleaved chunks stay
    // in their own lane and in order — no cross-contamination.
    expect(textOf(groups[0])).toBe('A1 A2')
    expect(textOf(groups[1])).toBe('B1 ')
  })

  it('renders a persisted subagent lane as closed when only endedAt is set (no subagent_end)', () => {
    // The Sim backend stamps endedAt on the subagent block but does not emit a
    // separate subagent_end block; a reloaded transcript must still show the
    // lane closed (no stuck delegating spinner).
    const blocks: ContentBlock[] = [
      {
        type: 'subagent',
        content: 'research',
        spanId: 'S1',
        parentSpanId: 'main',
        timestamp: 1,
        endedAt: 5,
      },
      { type: 'subagent_text', content: 'done', spanId: 'S1', subagent: 'research', timestamp: 2 },
    ]

    const segments = parseBlocks(blocks)
    const group = segments.find((s) => s.type === 'agent_group')
    expect(group).toBeDefined()
    if (!group || group.type !== 'agent_group') throw new Error('expected research group')
    expect(group.isOpen).toBe(false)
    expect(group.isDelegating).toBe(false)
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

  it('interleaves mothership tools with main text instead of clustering them at the top', () => {
    const blocks: ContentBlock[] = [
      mainText('Let me search.'),
      mainToolCall('t1', 'grep'),
      subagentStart('research', 'S1', 'main'),
      { type: 'subagent_text', content: 'looking', spanId: 'S1', timestamp: 2 },
      { type: 'subagent_end', spanId: 'S1', parentSpanId: 'main', timestamp: 3 },
      mainText('Found it, now finding files.'),
      mainToolCall('t2', 'glob'),
    ]

    const segments = parseBlocks(blocks)

    // Order is preserved chronologically: the second mothership tool stays below
    // the research subagent and the trailing text rather than jumping back up
    // into the first group.
    const shape = segments.map((s) => (s.type === 'agent_group' ? s.agentName : s.type))
    expect(shape).toEqual(['text', 'mothership', 'research', 'text', 'mothership'])

    // The two mothership tools land in two distinct groups, one each.
    const mothershipGroups = segments.filter(
      (s) => s.type === 'agent_group' && s.agentName === 'mothership'
    )
    expect(mothershipGroups).toHaveLength(2)
    const [first, second] = mothershipGroups
    if (first.type !== 'agent_group' || second.type !== 'agent_group') {
      throw new Error('expected mothership groups')
    }
    expect(first.items).toHaveLength(1)
    expect(second.items).toHaveLength(1)
    expect(first.items[0].type === 'tool' && first.items[0].data.toolName).toBe('grep')
    expect(second.items[0].type === 'tool' && second.items[0].data.toolName).toBe('glob')
  })

  it('absorbs the dispatch tool of a nested file subagent from its parent span group', () => {
    const blocks: ContentBlock[] = [
      subagentStart('workflow', 'S1', 'main'),
      subagentToolCall('t1', 'workspace_file', 'S1', 'workflow'),
      { type: 'subagent', content: 'file', spanId: 'S2', parentSpanId: 'S1', timestamp: 2 },
      { type: 'subagent_text', content: 'writing', spanId: 'S2', timestamp: 3 },
    ]

    const segments = parseBlocks(blocks)
    expect(segments).toHaveLength(1)
    const workflow = segments[0]
    if (workflow.type !== 'agent_group') throw new Error('expected workflow group')

    // The workspace_file dispatch tool is absorbed (not shown as a sibling tool);
    // only the nested file subagent remains under workflow.
    expect(workflow.items.some((item) => item.type === 'tool')).toBe(false)
    const nested = workflow.items.find((item) => item.type === 'agent_group')
    if (!nested || nested.type !== 'agent_group') throw new Error('expected nested file group')
    expect(nested.group.agentName).toBe('file')
  })

  it('renders subagent thinking as a muted thinking item and keeps the delegating spinner', () => {
    const blocks: ContentBlock[] = [
      subagentStart('workflow', 'S1', 'main'),
      {
        type: 'subagent_thinking',
        content: 'reasoning about the fix',
        spanId: 'S1',
        subagent: 'workflow',
        timestamp: 2,
      },
    ]

    const segments = parseBlocks(blocks)
    expect(segments).toHaveLength(1)
    if (segments[0].type !== 'agent_group') throw new Error('expected workflow group')
    // Thinking renders in the lane…
    expect(segments[0].items).toEqual([{ type: 'thinking', content: 'reasoning about the fix' }])
    // …but does not clear the delegating spinner (no real output yet).
    expect(segments[0].isDelegating).toBe(true)
  })

  it('creates the lane on demand when thinking arrives before its subagent start', () => {
    const blocks: ContentBlock[] = [
      {
        type: 'subagent_thinking',
        content: 'early reasoning',
        spanId: 'S1',
        parentSpanId: 'main',
        subagent: 'workflow',
        timestamp: 1,
      },
      subagentStart('workflow', 'S1', 'main'),
    ]

    const segments = parseBlocks(blocks)
    const group = segments.find((s) => s.type === 'agent_group')
    if (!group || group.type !== 'agent_group') throw new Error('expected workflow group')
    expect(group.agentName).toBe('workflow')
    expect(group.items).toEqual([{ type: 'thinking', content: 'early reasoning' }])
  })

  it('orders thinking before the lane text that follows it', () => {
    const blocks: ContentBlock[] = [
      subagentStart('workflow', 'S1', 'main'),
      {
        type: 'subagent_thinking',
        content: 'planning',
        spanId: 'S1',
        subagent: 'workflow',
        timestamp: 2,
      },
      { type: 'subagent_text', content: 'done', spanId: 'S1', subagent: 'workflow', timestamp: 3 },
    ]

    const segments = parseBlocks(blocks)
    if (segments[0].type !== 'agent_group') throw new Error('expected workflow group')
    expect(segments[0].items).toEqual([
      { type: 'thinking', content: 'planning' },
      { type: 'text', content: 'done' },
    ])
    expect(segments[0].isDelegating).toBe(false)
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

describe('shouldSmoothTextSegment', () => {
  it('only smooths the trailing text segment of a live stream', () => {
    expect(shouldSmoothTextSegment({ isStreaming: true, segmentIndex: 0, segmentCount: 2 })).toBe(
      false
    )
    expect(shouldSmoothTextSegment({ isStreaming: true, segmentIndex: 1, segmentCount: 2 })).toBe(
      true
    )
  })

  it('never smooths completed messages', () => {
    expect(shouldSmoothTextSegment({ isStreaming: false, segmentIndex: 0, segmentCount: 1 })).toBe(
      false
    )
  })
})

describe('parseBlocks legacy — thinking between top-level tools', () => {
  it('keeps consecutive mothership tools in one group across intervening thinking', () => {
    const blocks: ContentBlock[] = [
      { type: 'thinking', content: 'planning the search', timestamp: 1 },
      mainToolCall('t1', 'grep'),
      { type: 'thinking', content: 'now read the workflow', timestamp: 1 },
      mainToolCall('t2', 'read'),
      mainToolCall('t3', 'read'),
    ]
    const segments = parseBlocks(blocks)
    const groups = segments.filter((s) => s.type === 'agent_group')
    expect(groups).toHaveLength(1)
    if (groups[0].type !== 'agent_group') throw new Error('expected group')
    expect(groups[0].agentName).toBe('mothership')
    expect(groups[0].items).toHaveLength(3)
  })

  it('still splits the mothership run on real main text', () => {
    const blocks: ContentBlock[] = [
      mainToolCall('t1', 'grep'),
      mainText('Here is what I found so far.'),
      mainToolCall('t2', 'read'),
    ]
    const segments = parseBlocks(blocks)
    const groups = segments.filter((s) => s.type === 'agent_group')
    expect(groups).toHaveLength(2)
  })

  it('still breaks subagent lanes on main thinking', () => {
    const blocks: ContentBlock[] = [
      { type: 'subagent', content: 'workflow', parentToolCallId: 'd1', timestamp: 1 },
      { type: 'subagent_text', content: 'working', parentToolCallId: 'd1', timestamp: 1 },
      { type: 'thinking', content: 'main reasoning', timestamp: 1 },
      { type: 'subagent_text', content: 'later chunk with no lane tag', timestamp: 1 },
    ]
    const segments = parseBlocks(blocks)
    const groups = segments.filter((s) => s.type === 'agent_group')
    expect(groups).toHaveLength(1)
    if (groups[0].type !== 'agent_group') throw new Error('expected group')
    // The untagged chunk after thinking must NOT merge into the flushed lane.
    expect(groups[0].items).toHaveLength(1)
  })

  it('renders subagent thinking inside the legacy lane', () => {
    const blocks: ContentBlock[] = [
      { type: 'subagent', content: 'workflow', parentToolCallId: 'd1', timestamp: 1 },
      {
        type: 'subagent_thinking',
        content: 'legacy reasoning',
        parentToolCallId: 'd1',
        timestamp: 2,
      },
      { type: 'subagent_text', content: 'output', parentToolCallId: 'd1', timestamp: 3 },
    ]
    const segments = parseBlocks(blocks)
    const groups = segments.filter((s) => s.type === 'agent_group')
    expect(groups).toHaveLength(1)
    if (groups[0].type !== 'agent_group') throw new Error('expected group')
    expect(groups[0].items).toEqual([
      { type: 'thinking', content: 'legacy reasoning' },
      { type: 'text', content: 'output' },
    ])
  })
})
