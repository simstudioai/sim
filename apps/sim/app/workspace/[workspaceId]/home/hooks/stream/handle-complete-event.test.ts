import { describe, expect, it, vi } from 'vitest'
import { compactRetrievalCitations } from '@/lib/mothership/chat/retrieval-citations'
import type { PersistedStreamEventEnvelope } from '@/lib/mothership/request/session/contract'
import { collectCitedMessageSources } from '@/app/workspace/[workspaceId]/home/components/message-content/message-sources'
import { handleCompleteEvent } from '@/app/workspace/[workspaceId]/home/hooks/stream/handle-complete-event'
import { createStreamLoopContext } from '@/app/workspace/[workspaceId]/home/hooks/stream/stream-context'
import { makeStreamLoopDeps } from '@/app/workspace/[workspaceId]/home/hooks/stream/stream-test-helpers'
import type { ContentBlock } from '@/app/workspace/[workspaceId]/home/types'

const citationId = `document:live:${'x'.repeat(700)}`
const evidence = compactRetrievalCitations('search_workspace', {
  success: true,
  data: {
    results: [
      {
        citationId,
        citationUrl: 'https://sim.slack.com/archives/G1/p123',
        documentName: 'Group DM · Sid, Waleed',
        content: 'Evidence',
      },
      {
        citationId: 'unused',
        citationUrl: 'https://unused.test',
        documentName: 'Uncited search hit',
      },
    ],
  },
})
const blocks: ContentBlock[] = [
  {
    type: 'tool_call',
    toolCall: {
      id: 'search',
      name: 'search_workspace',
      status: 'success',
      result: { success: true, output: evidence },
    },
  },
  { type: 'text', content: `Answer <source>{"id":"${citationId}=="}</source>` },
]
function event(
  status: 'complete' | 'error' | 'cancelled' = 'complete'
): Extract<PersistedStreamEventEnvelope, { type: 'complete' }> {
  return {
    type: 'complete',
    v: 1,
    seq: 1,
    ts: '',
    stream: { streamId: 'run', cursor: '1' },
    payload: { status },
  }
}
function context(contentBlocks = blocks) {
  const onResourceEvent = vi.fn()
  const deps = makeStreamLoopDeps({
    citedSourcesEnabled: true,
    onResourceEventRef: { current: onResourceEvent },
  })
  const ctx = createStreamLoopContext(deps)
  ctx.ops.flush = vi.fn()
  deps.streamingBlocksRef.current = contentBlocks
  ctx.state.streamRequestId = 'run'
  return ctx
}

describe('completed answer source panel', () => {
  it('accepts padded live citation IDs and includes only cited main-answer evidence', () => {
    const citations = collectCitedMessageSources(
      [...blocks, { type: 'subagent_text', content: '<source>{"id":"unused"}</source>' }],
      ''
    )
    expect(citations).toHaveLength(1)
    expect(citations[0].title).toBe('Group DM · Sid, Waleed')
    const ctx = context()
    ctx.deps.resourcesRef.current = [
      {
        type: 'search',
        id: 'search:workspace:ws-1',
        title: 'Search results',
        workspaceId: 'ws-1',
        search: { query: 'evidence', scope: { kind: 'workspace', workspaceId: 'ws-1' } },
      },
    ]
    handleCompleteEvent(ctx, event())
    expect(ctx.deps.removeResource).toHaveBeenCalledWith('search', 'search:workspace:ws-1', 'ws-1')
    expect(ctx.deps.addResource).toHaveBeenCalledWith({
      type: 'sources',
      id: 'cited-sources',
      title: 'Sources',
      sources: { messageId: 'assistant-1', requestId: 'run' },
    })
    expect(ctx.deps.onResourceEventRef.current).toHaveBeenCalledWith('cited-sources', {
      revealCitedSources: true,
    })
  })
  it('leaves flag-off, replayed, and stale turns focus-free', () => {
    for (const kind of ['off', 'replay', 'stale']) {
      const ctx = context()
      if (kind === 'off') ctx.deps.citedSourcesEnabled = false
      if (kind === 'replay') ctx.deps.options.deferFlushes = true
      if (kind === 'stale') ctx.deps.streamGenRef.current++
      handleCompleteEvent(ctx, event())
      expect(ctx.deps.addResource).not.toHaveBeenCalled()
    }
  })
})
