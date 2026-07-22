/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { TOOL_CATALOG, type ToolCatalogEntry } from '@/lib/copilot/generated/tool-catalog-v1'
import type { PersistedStreamEventEnvelope } from '@/lib/copilot/request/session/contract'
import { getHiddenToolNames } from '@/lib/copilot/tools/client/hidden-tools'
import { getToolDisplayTitle, getToolStatusDisplayTitle } from '@/lib/copilot/tools/tool-display'
import {
  createTurnModel,
  reduceEvent,
} from '@/app/workspace/[workspaceId]/home/hooks/stream/turn-model'
import { modelToContentBlocks } from '@/app/workspace/[workspaceId]/home/hooks/stream/turn-model-serialize'
import type { ContentBlock } from '../../types'
import {
  assistantMessageHasVisibleExecutingTool,
  deriveThinkingLabel,
  parseBlocks,
  shouldSmoothTextSegment,
} from './message-content'

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

function representativeToolArgs(entry: ToolCatalogEntry): Record<string, unknown> {
  const args: Record<string, unknown> = {}
  if (!entry.parameters || typeof entry.parameters !== 'object') return args
  const properties = (entry.parameters as { properties?: unknown }).properties
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return args

  for (const [key, rawSchema] of Object.entries(properties)) {
    if (!rawSchema || typeof rawSchema !== 'object' || Array.isArray(rawSchema)) continue
    const schema = rawSchema as { default?: unknown; enum?: unknown; type?: unknown }
    if (schema.default !== undefined) {
      args[key] = schema.default
    } else if (Array.isArray(schema.enum) && schema.enum.length > 0) {
      args[key] = schema.enum[0]
    } else if (schema.type === 'boolean') {
      args[key] = true
    } else if (schema.type === 'object') {
      args[key] = {}
    }
  }
  return args
}

function toolEnvelope(
  seq: number,
  payload: Record<string, unknown>,
  agentId = 'deploy'
): PersistedStreamEventEnvelope {
  return {
    v: 1,
    seq,
    ts: new Date(seq).toISOString(),
    stream: { streamId: 'stream-1', cursor: String(seq) },
    type: 'tool',
    payload,
    scope: {
      lane: 'subagent',
      spanId: `${agentId}-span`,
      parentSpanId: 'main',
      agentId,
    },
  } as PersistedStreamEventEnvelope
}

describe('parseBlocks span-identity tree', () => {
  it('refines a completed credential rename with its previous and new names', () => {
    const segments = parseBlocks([
      {
        type: 'tool_call',
        toolCall: {
          id: 'rename-credential',
          name: 'manage_credential',
          status: 'success',
          params: { operation: 'rename', displayName: 'Production Stripe' },
          result: {
            success: true,
            output: {
              previousDisplayName: 'Stripe',
              displayName: 'Production Stripe',
            },
          },
        },
        timestamp: 1,
      },
    ])

    expect(segments).toHaveLength(1)
    const group = segments[0]
    if (group.type !== 'agent_group') throw new Error('expected mothership group')
    const tool = group.items[0]
    if (tool?.type !== 'tool') throw new Error('expected credential tool')
    expect(tool.data.displayTitle).toBe('Renamed Stripe to Production Stripe')
  })

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

  it('suppresses subagent thinking while keeping the delegating spinner', () => {
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
    expect(segments[0].items).toEqual([])
    // Suppressed reasoning does not count as visible output or clear activity.
    expect(segments[0].isDelegating).toBe(true)
  })

  it('does not create visible output when thinking arrives before its subagent start', () => {
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
    expect(group.items).toEqual([])
  })

  it('renders only assistant text after suppressed subagent thinking', () => {
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
    expect(segments[0].items).toEqual([{ type: 'text', content: 'done' }])
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

describe('completed tool titles', () => {
  function queryLogsCall(status: 'executing' | 'success' | 'error', displayTitle?: string) {
    return {
      type: 'tool_call' as const,
      toolCall: { id: 't1', name: 'query_logs', status, displayTitle },
      timestamp: 1,
    }
  }

  function firstToolTitle(blocks: ContentBlock[]): string {
    const segments = parseBlocks(blocks)
    const group = segments.find((s) => s.type === 'agent_group')
    if (!group || group.type !== 'agent_group') throw new Error('expected group')
    const tool = group.items.find((i) => i.type === 'tool')
    if (!tool || tool.type !== 'tool') throw new Error('expected tool')
    return tool.data.displayTitle
  }

  it('rewrites query_logs to past tense on success', () => {
    expect(firstToolTitle([queryLogsCall('success')])).toBe('Queried logs')
  })

  it('preserves the enriched workflow name in the past-tense title', () => {
    expect(firstToolTitle([queryLogsCall('success', 'Querying logs for Invoice Bot')])).toBe(
      'Queried logs for Invoice Bot'
    )
  })

  it('renders the completed deployment action and deployment type', () => {
    expect(
      firstToolTitle([
        {
          type: 'tool_call',
          toolCall: {
            id: 'undeploy-api',
            name: 'deploy_api',
            status: 'success',
            params: { action: 'undeploy' },
          },
          timestamp: 1,
        },
      ])
    ).toBe('Undeployed API')

    expect(firstToolTitle([mainToolCall('deploy-mcp', 'deploy_mcp')])).toBe('Deployed MCP tool')
  })

  it('renders Compared after the full diff_workflows wire lifecycle succeeds', () => {
    const model = createTurnModel()
    reduceEvent(
      model,
      toolEnvelope(1, {
        phase: 'call',
        toolCallId: 'diff-1',
        toolName: 'diff_workflows',
        arguments: { ref1: 'live', ref2: 'draft' },
      })
    )
    reduceEvent(
      model,
      toolEnvelope(2, {
        phase: 'result',
        toolCallId: 'diff-1',
        toolName: 'diff_workflows',
        success: true,
        status: 'success',
        output: { differences: [] },
      })
    )

    expect(firstToolTitle(modelToContentBlocks(model))).toBe('Compared workflows')
  })

  it('humanizes an internal read target through the full wire lifecycle', () => {
    const model = createTurnModel()
    reduceEvent(
      model,
      toolEnvelope(
        1,
        {
          phase: 'call',
          toolCallId: 'read-oauth-integrations',
          toolName: 'read',
          arguments: { path: 'environment/oauth-integrations.json' },
        },
        'auth'
      )
    )
    reduceEvent(
      model,
      toolEnvelope(
        2,
        {
          phase: 'result',
          toolCallId: 'read-oauth-integrations',
          toolName: 'read',
          success: true,
          status: 'success',
          output: {},
        },
        'auth'
      )
    )

    expect(firstToolTitle(modelToContentBlocks(model))).toBe('Read OAuth integrations')
  })

  it('renders the completed title through the full wire lifecycle for every visible tool', () => {
    const hiddenToolNames = getHiddenToolNames()
    const failures: string[] = []

    for (const [toolName, entry] of Object.entries(TOOL_CATALOG)) {
      // Internal subagent dispatches become agent groups, and hidden plumbing
      // is intentionally suppressed; neither produces a visible tool row.
      if (entry.internal || hiddenToolNames.has(toolName)) continue

      const args = representativeToolArgs(entry)
      const model = createTurnModel()
      reduceEvent(
        model,
        toolEnvelope(1, {
          phase: 'call',
          toolCallId: `${toolName}-1`,
          toolName,
          arguments: args,
        })
      )
      reduceEvent(
        model,
        toolEnvelope(2, {
          phase: 'result',
          toolCallId: `${toolName}-1`,
          toolName,
          success: true,
          status: 'success',
          output: {},
        })
      )

      const presentTitle = getToolDisplayTitle(toolName, args)
      const expectedTitle = getToolStatusDisplayTitle(presentTitle, 'success')
      const actualTitle = firstToolTitle(modelToContentBlocks(model))
      if (actualTitle !== expectedTitle) {
        failures.push(`${toolName}: expected ${expectedTitle}, received ${actualTitle}`)
      }
    }

    expect(failures).toEqual([])
  })

  it('keeps present tense while executing and on error', () => {
    expect(firstToolTitle([queryLogsCall('executing')])).toBe('Querying logs')
    expect(firstToolTitle([queryLogsCall('error')])).toBe('Querying logs')
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

  it('does not double-space when the seam already has whitespace', () => {
    const blocks: ContentBlock[] = [
      subagentStart('research', 'S1', 'main'),
      {
        type: 'subagent_text',
        content: 'first sentence. ',
        spanId: 'S1',
        subagent: 'research',
        timestamp: 2,
      },
      {
        type: 'subagent_text',
        content: 'second sentence.',
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
    expect(text.content).toBe('first sentence. second sentence.')
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

  it('suppresses subagent thinking inside the legacy lane', () => {
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
    expect(groups[0].items).toEqual([{ type: 'text', content: 'output' }])
  })
})

describe('assistantMessageHasVisibleExecutingTool', () => {
  it('does not treat an open subagent lane as an executing tool row', () => {
    expect(assistantMessageHasVisibleExecutingTool([subagentStart('workflow', 'S1', 'main')])).toBe(
      false
    )
  })

  it('keeps a visible executing tool as active work', () => {
    const blocks: ContentBlock[] = [
      subagentStart('workflow', 'S1', 'main'),
      {
        type: 'tool_call',
        toolCall: { id: 't1', name: 'grep', status: 'executing', calledBy: 'workflow' },
        spanId: 'S1',
        timestamp: 3,
      },
    ]
    expect(assistantMessageHasVisibleExecutingTool(blocks)).toBe(true)
  })

  it('does not let open parallel lanes suppress the single turn-level indicator', () => {
    const blocks: ContentBlock[] = [
      subagentStart('workflow', 'S1', 'main'),
      subagentStart('search', 'S2', 'main'),
    ]
    expect(assistantMessageHasVisibleExecutingTool(blocks)).toBe(false)
  })

  it('ignores the executing dispatch tool represented by its subagent lane', () => {
    const blocks: ContentBlock[] = [
      {
        type: 'tool_call',
        toolCall: { id: 'dispatch-1', name: 'workspace_file', status: 'executing' },
        timestamp: 1,
      },
      {
        ...subagentStart('file', 'S1', 'main'),
        parentToolCallId: 'dispatch-1',
      },
    ]
    expect(assistantMessageHasVisibleExecutingTool(blocks)).toBe(false)
  })
})

describe('deriveThinkingLabel', () => {
  it('maps the most recent block to an activity phrase', () => {
    expect(deriveThinkingLabel([])).toBe('Thinking…')
    expect(deriveThinkingLabel([{ type: 'thinking', content: 'hm', timestamp: 1 }])).toBe(
      'Thinking…'
    )
    // A stall after streamed text is the agent deciding what's next, not generating.
    expect(deriveThinkingLabel([mainText('hi')])).toBe('Thinking…')
    expect(deriveThinkingLabel([{ type: 'subagent_text', content: 'x', timestamp: 1 }])).toBe(
      'Thinking…'
    )
    expect(deriveThinkingLabel([{ type: 'subagent_end', spanId: 'S1', timestamp: 1 }])).toBe(
      'Returning…'
    )
  })

  it('shows Dispatching for the dispatch call, then yields to the opened lane', () => {
    expect(deriveThinkingLabel([mainToolCall('t1', 'workflow')])).toBe('Dispatching…')
    expect(deriveThinkingLabel([mainToolCall('t1', 'workspace_file')])).toBe('Dispatching…')
    expect(deriveThinkingLabel([mainToolCall('t1', 'grep')])).toBe('Thinking…')
    expect(deriveThinkingLabel([subagentStart('workflow', 'S1', 'main')])).toBeNull()
  })
})
