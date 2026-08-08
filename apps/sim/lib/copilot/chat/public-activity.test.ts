/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import { ChatActivityProjector } from '@/lib/copilot/chat/public-activity'
import type { MothershipStreamV1StreamScope } from '@/lib/copilot/generated/mothership-stream-v1'
import type { StreamEvent } from '@/lib/copilot/request/types'

vi.mock('@/lib/copilot/tools/client/read-block', () => ({
  getReadTargetBlock: vi.fn((path: string | undefined) =>
    path?.startsWith('components/') ? { name: 'Gmail' } : undefined
  ),
}))

const call = (over: Record<string, unknown> = {}) => ({
  toolCallId: 'private-call-id',
  toolName: 'read',
  phase: 'call',
  arguments: { secret: 'never-forward-me' },
  executor: 'go',
  mode: 'sync',
  ...over,
})

const result = (over: Record<string, unknown> = {}) =>
  call({
    phase: 'result',
    success: true,
    output: { secret: 'never-forward-me' },
    arguments: undefined,
    ...over,
  })

const tool = (payload: Record<string, unknown>, scope?: MothershipStreamV1StreamScope) =>
  ({ type: 'tool', payload, ...(scope ? { scope } : {}) }) as StreamEvent

const span = (
  event: 'start' | 'end',
  scope: MothershipStreamV1StreamScope,
  over: Record<string, unknown> = {}
) =>
  ({
    type: 'span',
    scope,
    payload: { kind: 'subagent', event, agent: scope.agentId, ...over },
  }) as StreamEvent

const text = (
  channel: 'assistant' | 'thinking',
  value: string,
  scope?: MothershipStreamV1StreamScope
) =>
  ({
    type: 'text',
    payload: { channel, text: value },
    ...(scope ? { scope } : {}),
  }) as StreamEvent

const researchScope: MothershipStreamV1StreamScope = {
  lane: 'subagent',
  agentId: 'research',
  parentToolCallId: 'private-dispatch-id',
  spanId: 'private-research-span',
  parentSpanId: 'main',
}

describe('ChatActivityProjector', () => {
  it('correlates a visible root call and result without exposing their raw payload', () => {
    const projector = new ChatActivityProjector()

    const [running] = projector.project(tool(call()))
    const [complete] = projector.project(tool(result()))

    expect(running).toEqual({
      kind: 'tool',
      id: 'tool-1',
      label: 'Reading file',
      state: 'running',
    })
    expect(complete).toEqual({ ...running, label: 'Read file', state: 'complete' })
    expect(JSON.stringify([running, complete])).not.toContain('private-call-id')
    expect(JSON.stringify([running, complete])).not.toContain('never-forward-me')
  })

  it.each([
    ['workflows/forceful-arm/state.json', 'forceful-arm'],
    ['components/blocks/gmail_v2.json', 'Gmail'],
    ['components/integrations/gmail/send.json', 'Gmail'],
  ])('uses the web read label for %s without forwarding arguments', (path, target) => {
    const projector = new ChatActivityProjector()
    const activities = [
      ...projector.project(tool(call({ arguments: { path, secret: 'never-forward-me' } }))),
      ...projector.project(tool(result())),
    ]

    expect(activities).toEqual([
      { kind: 'tool', id: 'tool-1', label: `Reading ${target}`, state: 'running' },
      { kind: 'tool', id: 'tool-1', label: `Read ${target}`, state: 'complete' },
    ])
    expect(JSON.stringify(activities)).not.toContain(path)
    expect(JSON.stringify(activities)).not.toContain('never-forward-me')
  })

  it('maps failed and skipped terminal outcomes', () => {
    const failed = new ChatActivityProjector()
    failed.project(tool(call()))
    expect(failed.project(tool(result({ success: false, error: 'private failure' })))).toEqual([
      expect.objectContaining({ label: 'Reading file', state: 'error' }),
    ])

    expect(
      new ChatActivityProjector().project(tool(call({ status: 'skipped', success: false })))
    ).toEqual([expect.objectContaining({ label: 'Reading file', state: 'complete' })])

    for (const status of ['cancelled', 'rejected']) {
      const projector = new ChatActivityProjector()
      projector.project(tool(call()))
      expect(projector.project(tool(result({ status, success: true })))[0]).toMatchObject({
        state: 'error',
      })
    }
  })

  it('waits for an authoritative call and holds an early result', () => {
    const generating = new ChatActivityProjector()
    expect(generating.project(tool(call({ partial: true, status: 'generating' })))).toEqual([])
    expect(generating.project(tool(call({ partial: false, status: 'executing' })))).toEqual([
      {
        kind: 'tool',
        id: 'tool-1',
        label: 'Reading file',
        state: 'running',
      },
    ])

    const reordered = new ChatActivityProjector()
    expect(reordered.project(tool(result()))).toEqual([])
    expect(reordered.project(tool(call()))).toEqual([
      {
        kind: 'tool',
        id: 'tool-1',
        label: 'Read file',
        state: 'complete',
      },
    ])
  })

  it('suppresses hidden, internal, and internal-result calls without id gaps', () => {
    const projector = new ChatActivityProjector()

    for (const payload of [
      call({ toolCallId: 'hidden', ui: { hidden: true } }),
      call({ toolCallId: 'internal', ui: { internal: true } }),
      call({ toolCallId: 'legacy', toolName: 'load_skill' }),
      call({
        toolCallId: 'tool-result-read',
        arguments: { path: 'internal/tool-results/private' },
      }),
    ]) {
      expect(projector.project(tool(payload))).toEqual([])
    }

    expect(projector.project(tool(call({ toolCallId: 'visible' })))[0]).toMatchObject({
      id: 'tool-1',
    })
  })

  it('provisions root and nested subagent lanes from dispatch calls before span start', () => {
    const root = new ChatActivityProjector()
    expect(
      root.project(tool(call({ toolCallId: 'workflow-dispatch', toolName: 'workflow' })))
    ).toEqual([
      {
        kind: 'subagent',
        id: 'agent-1',
        label: 'Workflow Agent',
        state: 'running',
      },
    ])
    const workflowScope = {
      lane: 'subagent' as const,
      agentId: 'workflow',
      spanId: 'workflow-span',
      parentSpanId: 'main',
      parentToolCallId: 'workflow-dispatch',
    }
    expect(root.project(span('start', workflowScope))).toEqual([])

    const nested = new ChatActivityProjector()
    nested.project(span('start', researchScope))
    expect(
      nested.project(
        tool(call({ toolCallId: 'deploy-dispatch', toolName: 'deploy' }), researchScope)
      )
    ).toEqual([
      {
        kind: 'subagent',
        id: 'agent-2',
        parentId: 'agent-1',
        label: 'Deploy Agent',
        state: 'running',
      },
    ])
    expect(
      nested.project(
        span('start', {
          lane: 'subagent',
          agentId: 'deploy',
          spanId: 'deploy-span',
          parentSpanId: researchScope.spanId,
          parentToolCallId: 'deploy-dispatch',
        })
      )
    ).toEqual([])
  })

  it('projects subagent lifecycle, scoped tools, and narration as an opaque tree', () => {
    const projector = new ChatActivityProjector()
    const activities = [
      ...projector.project(span('start', researchScope)),
      ...projector.project(tool(call({ toolCallId: 'private-child-tool' }), researchScope)),
      ...projector.project(text('assistant', 'I found the answer.', researchScope)),
      ...projector.project(text('thinking', 'private chain of thought', researchScope)),
      // Sim/client tool results are synthesized without their original scope.
      ...projector.project(tool(result({ toolCallId: 'private-child-tool' }))),
      ...projector.project(span('end', researchScope)),
    ]

    expect(activities).toEqual([
      {
        kind: 'subagent',
        id: 'agent-1',
        label: 'Research Agent',
        state: 'running',
      },
      {
        kind: 'tool',
        id: 'tool-1',
        parentId: 'agent-1',
        label: 'Reading file',
        state: 'running',
      },
      { kind: 'narration', parentId: 'agent-1', delta: 'I found the answer.' },
      {
        kind: 'tool',
        id: 'tool-1',
        parentId: 'agent-1',
        label: 'Read file',
        state: 'complete',
      },
      {
        kind: 'subagent',
        id: 'agent-1',
        label: 'Research Agent',
        state: 'complete',
      },
    ])
    const serialized = JSON.stringify(activities)
    for (const privateValue of [
      'private-child-tool',
      'private-dispatch-id',
      'private-research-span',
      'never-forward-me',
      'private chain of thought',
    ]) {
      expect(serialized).not.toContain(privateValue)
    }
  })

  it('nests subagents by opaque span parent ids and keeps parallel same-name runs distinct', () => {
    const projector = new ChatActivityProjector()
    const parent = { ...researchScope, spanId: 'parent', parentToolCallId: 'parent-call' }
    const child = {
      ...researchScope,
      spanId: 'child',
      parentSpanId: 'parent',
      parentToolCallId: 'child-call',
    }
    const sibling = {
      ...researchScope,
      spanId: 'sibling',
      parentToolCallId: 'sibling-call',
    }

    expect(projector.project(span('start', parent))).toEqual([
      expect.objectContaining({ id: 'agent-1', label: 'Research Agent' }),
    ])
    expect(projector.project(span('start', child))).toEqual([
      expect.objectContaining({ id: 'agent-2', parentId: 'agent-1' }),
    ])
    expect(projector.project(span('start', sibling))).toEqual([
      expect.objectContaining({ id: 'agent-3', label: 'Research Agent' }),
    ])
  })

  it('reconciles a pre-start lane to the authoritative agent without changing its id', () => {
    const projector = new ChatActivityProjector()
    const provisional = { ...researchScope, agentId: 'superagent' }

    expect(projector.project(text('assistant', 'Starting.', provisional))).toEqual([
      expect.objectContaining({ kind: 'subagent', id: 'agent-1', label: 'Superagent' }),
      { kind: 'narration', parentId: 'agent-1', delta: 'Starting.' },
    ])
    expect(projector.project(span('start', provisional, { agent: 'file' }))).toEqual([
      expect.objectContaining({ kind: 'subagent', id: 'agent-1', label: 'File Agent' }),
    ])
  })

  it('keeps pending span ends open and exposes terminal errors without their details', () => {
    const projector = new ChatActivityProjector()
    projector.project(span('start', researchScope))

    expect(projector.project(span('end', researchScope, { data: { pending: true } }))).toEqual([])
    const terminal = projector.project(
      span('end', researchScope, { data: { error: 'private backend failure' } })
    )
    expect(terminal).toEqual([
      expect.objectContaining({ id: 'agent-1', state: 'error', label: 'Research Agent' }),
    ])
    expect(JSON.stringify(terminal)).not.toContain('private backend failure')
  })

  it('settles open tools and agents, using past tense only on success', () => {
    const successful = new ChatActivityProjector()
    successful.project(span('start', researchScope))
    successful.project(tool(call(), researchScope))
    expect(successful.finish('complete')).toEqual([
      expect.objectContaining({ kind: 'tool', label: 'Read file', state: 'complete' }),
      expect.objectContaining({ kind: 'subagent', state: 'complete' }),
    ])
    expect(successful.finish('complete')).toEqual([])

    const failed = new ChatActivityProjector()
    failed.project(span('start', researchScope))
    failed.project(tool(call(), researchScope))
    expect(failed.finish('error')).toEqual([
      expect.objectContaining({ kind: 'tool', label: 'Reading file', state: 'error' }),
      expect.objectContaining({ kind: 'subagent', state: 'error' }),
    ])
  })

  it('absorbs a workspace_file dispatch into its matching file subagent', () => {
    const projector = new ChatActivityProjector()
    const workspaceCall = call({ toolCallId: 'workspace-dispatch', toolName: 'workspace_file' })
    const fileScope = {
      lane: 'subagent' as const,
      agentId: 'file',
      spanId: 'file-span',
      parentSpanId: 'main',
      parentToolCallId: 'workspace-dispatch',
    }

    expect(projector.project(tool(workspaceCall))).toEqual([])
    expect(
      projector.project(
        tool(result({ toolCallId: 'workspace-dispatch', toolName: 'workspace_file' }))
      )
    ).toEqual([])
    expect(projector.project(span('start', fileScope))).toEqual([
      {
        kind: 'subagent',
        id: 'agent-1',
        label: 'File Agent',
        state: 'running',
      },
    ])
    expect(projector.project(tool(call({ toolCallId: 'visible-root' })))[0]).toMatchObject({
      id: 'tool-1',
    })
  })

  it('drops argument deltas, synthetic preview frames, and malformed events', () => {
    const projector = new ChatActivityProjector()

    expect(projector.project(tool(call({ phase: 'args_delta' })))).toEqual([])
    expect(projector.project(tool(call({ phase: undefined })))).toEqual([])
    expect(projector.project(tool(call({ toolCallId: '' })))).toEqual([])
    expect(projector.project(tool(call({ toolName: undefined })))).toEqual([])
  })
})
