import { authClientMock } from '@sim/testing/mocks/auth-client.mock'
import { describe, expect, it, vi } from 'vitest'

/**
 * `@/lib/auth/auth-client` builds a Better Auth client at module scope, which
 * throws when NEXT_PUBLIC_APP_URL is absent from the environment (and under
 * `isolate: false` an earlier file may have imported the graph in a polluted
 * env). These tests only exercise pure parsing/model helpers, so stub the
 * client module out entirely.
 */
vi.mock('@/lib/auth/auth-client', () => authClientMock)

import { toDisplayMessage } from '@/lib/mothership/chat/display-message'
import { normalizeMessage, stripToolResultOutput } from '@/lib/mothership/chat/persisted-message'
import {
  getTurnLiveIndicators,
  ownsTurnWait,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/lane-activity'
import type { ContentBlock } from '../../types'
import { getOrchestratorMessageText, parseBlocks } from './message-content'

/** Whether the transcript owns the turn's wait, read through the rule's single owner. */
function ownsWait(segments: ReturnType<typeof parseBlocks>, isStreaming = false): boolean {
  return ownsTurnWait(
    getTurnLiveIndicators(
      segments.flatMap((segment) => (segment.type === 'agent_group' ? [segment] : [])),
      isStreaming
    )
  )
}

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

describe('top-level activity groups', () => {
  const activityCall = (id: string, title?: string, spanId?: string): ContentBlock => ({
    type: 'tool_call',
    spanId,
    toolCall: {
      id,
      name: 'sim_cli',
      status: 'executing',
      params: title
        ? {
            activity: { id: title, title, completedTitle: title.replace('Checking', 'Checked') },
          }
        : {},
    },
  })
  const activityReference = (id: string, activityId: string, spanId?: string): ContentBlock => ({
    type: 'tool_call',
    spanId,
    toolCall: {
      id,
      name: 'sim_cli',
      status: 'executing',
      params: { activity: { id: activityId } },
    },
  })

  it.each([undefined, 'main'])(
    'keeps interleaved parallel calls in one chronological active group (%s)',
    (spanId) => {
      const blocks = [
        activityCall('a1', 'Checking invoice inputs', spanId),
        activityReference('a2', 'Checking invoice inputs', spanId),
        activityCall('b1', 'Checking customer inputs', spanId),
        activityReference('a3', 'Checking invoice inputs', spanId),
        activityReference('a4', 'Checking invoice inputs', spanId),
      ]
      const groups = parseBlocks(blocks).filter((segment) => segment.type === 'agent_group')
      expect(groups).toHaveLength(1)
      expect(
        groups.map((group) =>
          group.items.flatMap((item) => (item.type === 'tool' ? [item.data.id] : []))
        )
      ).toEqual([['a1', 'a2', 'b1', 'a3', 'a4']])
      const completed = blocks.map(
        (block): ContentBlock => ({
          ...block,
          toolCall: block.toolCall ? { ...block.toolCall, status: 'success' } : undefined,
        })
      )
      const stillRunning = [...completed.slice(0, -1), blocks.at(-1)!]
      expect(parseBlocks(stillRunning)).toHaveLength(3)
      const finished = parseBlocks(completed)
      expect(finished).toHaveLength(3)
      expect(finished[0]).toMatchObject({ id: groups[0].id })
      expect(
        finished.map((group) => group.type === 'agent_group' && group.activity?.completedTitle)
      ).toEqual(['Checked invoice inputs', 'Checked customer inputs', 'Checked invoice inputs'])
      expect(
        finished.flatMap((group) =>
          group.type === 'agent_group'
            ? group.items.map((item) => item.type === 'tool' && item.data.id)
            : []
        )
      ).toEqual(['a1', 'a2', 'b1', 'a3', 'a4'])
    }
  )

  it('keeps every completed activity under its own header across text and reused ids', () => {
    const blocks = [
      activityCall('a1', 'Checking invoice inputs'),
      activityCall('b1', 'Checking customer inputs'),
      mainText('Now checking the updated inputs.'),
      activityReference('a2', 'Checking invoice inputs'),
      activityReference('b2', 'Checking customer inputs'),
    ].map(
      (block): ContentBlock => ({
        ...block,
        toolCall: block.toolCall ? { ...block.toolCall, status: 'success' } : undefined,
      })
    )
    const segments = parseBlocks(blocks)
    expect(segments.map((segment) => segment.type)).toEqual([
      'agent_group',
      'agent_group',
      'text',
      'agent_group',
      'agent_group',
    ])
    const groups = segments.filter((segment) => segment.type === 'agent_group')
    expect(new Set(groups.map((group) => group.id)).size).toBe(4)
    expect(groups.map((group) => group.activity?.completedTitle)).toEqual([
      'Checked invoice inputs',
      'Checked customer inputs',
      'Checked invoice inputs',
      'Checked customer inputs',
    ])
    expect(
      groups.map((group) => group.items.map((item) => item.type === 'tool' && item.data.id))
    ).toEqual([['a1'], ['b1'], ['a2'], ['b2']])
  })

  it('keeps only the latest sequential activity open through thinking gaps', () => {
    const completed = [
      activityCall('a1', 'Checking invoice inputs'),
      activityCall('b1', 'Checking customer inputs'),
      activityReference('a2', 'Checking invoice inputs'),
    ].map(
      (block): ContentBlock => ({
        ...block,
        toolCall: { ...block.toolCall!, status: 'success' },
      })
    )
    const open = parseBlocks(completed, true)
    expect(open).toHaveLength(3)
    expect(open).toMatchObject([
      { isOpen: false, items: [{ data: { id: 'a1' } }] },
      { isOpen: false, items: [{ data: { id: 'b1' } }] },
      { isOpen: true, items: [{ data: { id: 'a2' } }] },
    ])
    const settled = parseBlocks(completed, false)
    expect(settled).toMatchObject([
      { isOpen: false, activity: { completedTitle: 'Checked invoice inputs' } },
      { isOpen: false, activity: { completedTitle: 'Checked customer inputs' } },
      { isOpen: false, activity: { completedTitle: 'Checked invoice inputs' } },
    ])
    const proseClosed = parseBlocks([...completed, mainText('The inputs are ready.')], true)
    expect(proseClosed.map((segment) => segment.type)).toEqual([
      'agent_group',
      'agent_group',
      'agent_group',
      'text',
    ])
    expect(proseClosed.slice(0, 3)).toMatchObject([
      { isOpen: false },
      { isOpen: false },
      { isOpen: false },
    ])
  })

  it('keeps one active group when parallel calls settle out of order without reordering history', () => {
    const blocks = [
      activityCall('a1', 'Checking invoice inputs'),
      activityCall('b1', 'Checking customer inputs'),
    ]
    blocks[1].toolCall!.status = 'success'
    const pending = parseBlocks(blocks, true)
    expect(pending).toHaveLength(1)
    expect(pending[0]).toMatchObject({
      activity: { title: 'Checking invoice inputs' },
      items: [{ data: { id: 'a1' } }, { data: { id: 'b1' } }],
    })
    blocks[0].toolCall!.status = 'success'
    const open = parseBlocks(blocks, true).filter((segment) => segment.type === 'agent_group')
    expect(open.map((group) => group.isOpen)).toEqual([false, true])
    expect(open[0].id).toBe(pending[0].type === 'agent_group' ? pending[0].id : '')
    expect(parseBlocks(blocks)).toMatchObject([
      { activity: { title: 'Checking invoice inputs' }, items: [{ data: { id: 'a1' } }] },
      { activity: { title: 'Checking customer inputs' }, items: [{ data: { id: 'b1' } }] },
    ])
  })

  it('does not merge activities across prose or absorb a subagent into the main activity', () => {
    const segments = parseBlocks([
      activityCall('a1', 'Checking invoice inputs'),
      mainText('The invoice inputs are valid.'),
      activityReference('a2', 'Checking invoice inputs'),
      subagentStart('general', 'child', 'main'),
      {
        ...activityCall('child-tool', 'Checking customer inputs', 'child'),
        toolCall: {
          ...activityCall('child-tool', 'Checking customer inputs').toolCall!,
          calledBy: 'general',
        },
      },
    ])
    expect(segments.map((segment) => segment.type)).toEqual([
      'agent_group',
      'text',
      'agent_group',
      'agent_group',
    ])
    expect(
      segments.filter((segment) => segment.type === 'agent_group').map((group) => group.agentName)
    ).toEqual(['mothership', 'mothership', 'general'])
  })
})

describe('getOrchestratorMessageText', () => {
  it('separates orchestrator text blocks around excluded subagent output', () => {
    const blocks: ContentBlock[] = [
      mainText('Starting answer.'),
      subagentStart('research', 'span-visible', 'main'),
      {
        type: 'subagent_text',
        content: 'Visible research.',
        spanId: 'span-visible',
        timestamp: 2,
      },
      mainText('Main answer.'),
    ]

    expect(getOrchestratorMessageText(blocks, 'Fallback.')).toBe('Starting answer.\n\nMain answer.')
  })
})

describe('parseBlocks span-identity tree', () => {
  it('nests a deploy subagent inside the workflow subagent that spawned it', () => {
    const blocks: ContentBlock[] = [
      subagentStart('workflow', 'S1', 'main'),
      subagentToolCall('t1', 'create_workflow', 'S1', 'workflow'),
      subagentStart('deploy', 'S2', 'S1'),
      subagentToolCall('t2', 'get_deployment_status', 'S2', 'deploy'),
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

  it('retains main activity around prose and subagents in stream order', () => {
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

    const shape = segments.map((s) => (s.type === 'agent_group' ? s.agentName : s.type))
    expect(shape).toEqual(['text', 'mothership', 'research', 'text', 'mothership'])

    const mothershipGroups = segments.filter(
      (s) => s.type === 'agent_group' && s.agentName === 'mothership'
    )
    expect(mothershipGroups).toHaveLength(2)
    expect(
      mothershipGroups.flatMap((group) =>
        group.type === 'agent_group'
          ? group.items.flatMap((item) => (item.type === 'tool' ? [item.data.id] : []))
          : []
      )
    ).toEqual(['t1', 't2'])
  })
})

describe('narration text seams', () => {
  it('never inserts a space into a segment split mid-word or mid-URL', () => {
    const seam = (first: string, second: string): string => {
      const blocks: ContentBlock[] = [
        subagentStart('research', 'S1', 'main'),
        { type: 'subagent_text', content: first, spanId: 'S1', subagent: 'research', timestamp: 2 },
        {
          type: 'subagent_text',
          content: second,
          spanId: 'S1',
          subagent: 'research',
          timestamp: 3,
        },
      ]
      const segments = parseBlocks(blocks)
      const group = segments.find((s) => s.type === 'agent_group')
      if (!group || group.type !== 'agent_group') throw new Error('expected group')
      const text = group.items.find((i) => i.type === 'text')
      if (!text || text.type !== 'text') throw new Error('expected text')
      return text.content
    }

    expect(seam('the fox jum', 'ps over')).toBe('the fox jumps over')
    expect(seam('see https://example', '/path for details')).toBe(
      'see https://example/path for details'
    )
    expect(seam('日本語のテキストが分割', 'されても壊れない')).toBe(
      '日本語のテキストが分割されても壊れない'
    )
    expect(seam('released in v2.', '1 last week')).toBe('released in v2.1 last week')
    expect(seam('pi is 3.', '14 roughly')).toBe('pi is 3.14 roughly')
  })
})

describe('parseBlocks legacy — thinking between top-level tools', () => {
  it('retains every main tool across intervening thinking', () => {
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
    expect(groups[0].items.map((item) => item.type === 'tool' && item.data.id)).toEqual([
      't1',
      't2',
      't3',
    ])
  })

  it('does not let main thinking affect subagent lane grouping', () => {
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
    // Thinking is absent from persistence, so it cannot split the live lane.
    expect(groups[0].items).toHaveLength(1)
    expect(groups[0].items[0]).toEqual({
      type: 'text',
      content: 'workinglater chunk with no lane tag',
    })
  })
})

describe('turn wait ownership', () => {
  it.each(['error', 'cancelled'] as const)(
    'leaves the gap after a %s main tool to the turn indicator',
    (status) => {
      const blocks: ContentBlock[] = [
        { type: 'tool_call', toolCall: { id: 'last', name: 'read', status }, timestamp: 1 },
      ]
      expect(ownsWait(parseBlocks(blocks, true), true)).toBe(false)
    }
  )

  it.each([undefined, 'main'])('retains an earlier running tool with spanId=%s', (spanId) => {
    const blocks: ContentBlock[] = [
      {
        type: 'tool_call',
        toolCall: { id: 'older', name: 'grep', status: 'executing' },
        spanId,
        timestamp: 1,
      },
      mainText('Reading the result.'),
      mainToolCall('latest', 'read'),
    ]
    const segments = parseBlocks(blocks, true)
    expect(segments.map((segment) => segment.type)).toEqual(['agent_group', 'text', 'agent_group'])
    expect(ownsWait(segments, true)).toBe(true)
    expect(ownsWait(parseBlocks(blocks), false)).toBe(false)
  })

  it('does not let open parallel lanes suppress the single turn-level indicator', () => {
    const blocks: ContentBlock[] = [
      subagentStart('workflow', 'S1', 'main'),
      subagentStart('search', 'S2', 'main'),
    ]
    expect(ownsWait(parseBlocks(blocks))).toBe(false)
  })
})

describe('parseBlocks main activity controls', () => {
  it.each([undefined, 'main'])(
    'retains interaction controls and answers across prose and completion with spanId=%s',
    (spanId) => {
      const blocks: ContentBlock[] = [
        {
          type: 'tool_call',
          toolCall: { id: 'permission', name: 'read', status: 'awaiting_approval' },
          spanId,
          timestamp: 1,
        },
        mainText('A permission decision is pending.'),
        {
          type: 'tool_call',
          toolCall: {
            id: 'handoff',
            name: 'terminal',
            status: 'executing',
            params: { operation: 'handoff' },
          },
          timestamp: 2,
        },
        {
          type: 'tool_call',
          toolCall: {
            id: 'answered-takeover',
            name: 'browser_request_takeover',
            status: 'success',
            params: { reason: 'Choose a result.' },
            result: { success: true, output: { userInstruction: 'Open the second result.' } },
          },
          timestamp: 2,
        },
        mainToolCall('older', 'grep'),
        mainText('Checking another source.'),
        {
          type: 'tool_call',
          toolCall: { id: 'latest', name: 'read', status: 'executing' },
          timestamp: 3,
        },
      ]

      const visibleTools = (content: ContentBlock[]) =>
        parseBlocks(content).flatMap((segment) =>
          segment.type === 'agent_group'
            ? segment.items.flatMap((item) => (item.type === 'tool' ? [item.data] : []))
            : []
        )

      expect(visibleTools(blocks).map((tool) => tool.id)).toEqual([
        'permission',
        'handoff',
        'answered-takeover',
        'older',
        'latest',
      ])
      const completed = blocks.map((block) =>
        block.toolCall?.id === 'latest'
          ? { ...block, toolCall: { ...block.toolCall, status: 'success' as const } }
          : block
      )
      expect(visibleTools(completed).map((tool) => tool.id)).toEqual([
        'permission',
        'handoff',
        'answered-takeover',
        'older',
        'latest',
      ])
      expect(visibleTools(completed).at(-1)?.status).toBe('success')
    }
  )
})

describe.each([undefined, 'main'])('watch presentation (%s)', (spanId) => {
  const watch: ContentBlock = {
    type: 'task',
    task: {
      taskId: 'timer-1',
      kind: 'timer',
      target: {},
      note: 'Check results',
      status: 'pending',
    },
  }
  const registration: ContentBlock = {
    type: 'tool_call',
    spanId,
    toolCall: {
      id: 'watch-call',
      name: 'watch',
      status: 'success',
      result: { success: true, output: { ok: true, taskId: 'timer-1' } },
    },
  }

  it.each(['pending', 'completed', 'stopped'] as const)(
    'does not duplicate a %s watch on replay',
    (status) => {
      const recorded = { ...watch, task: { ...watch.task!, status } }
      expect(parseBlocks([registration, recorded])).toEqual([{ type: 'task', task: recorded.task }])
    }
  )

  it('preserves only the watch identity through persisted output stripping and reload', () => {
    const stored = normalizeMessage({
      id: 'message',
      role: 'assistant',
      content: '',
      contentBlocks: [
        {
          type: 'tool',
          spanId,
          toolCall: {
            id: 'watch-call',
            name: 'watch',
            state: 'success',
            result: {
              success: true,
              output: { ok: true, taskId: 'timer-1', large: 'x'.repeat(10000) },
            },
          },
        },
        watch,
      ],
    })
    const stripped = stripToolResultOutput(stored)
    expect(stripped.contentBlocks[0].toolCall?.result?.output).toEqual({ taskId: 'timer-1' })
    expect(stripToolResultOutput(stripped)).toBe(stripped)
    expect(parseBlocks(toDisplayMessage(stripped).contentBlocks ?? [])).toEqual([watch])
  })
})
