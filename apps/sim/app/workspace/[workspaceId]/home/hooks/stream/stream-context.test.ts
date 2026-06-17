/**
 * @vitest-environment node
 */

import { describe, expect, it, vi } from 'vitest'
import type { PersistedStreamEventEnvelope } from '@/lib/copilot/request/session/contract'
import type { ChatMessage, ContentBlock } from '@/app/workspace/[workspaceId]/home/types'
import { ToolCallStatus } from '@/app/workspace/[workspaceId]/home/types'
import { createStreamLoopContext } from './stream-context'
import { makeStreamLoopDeps, ref } from './stream-test-helpers'
import { reduceEvent } from './turn-model'

function textEnvelope(text: string): PersistedStreamEventEnvelope {
  return {
    v: 1,
    seq: 1,
    ts: '',
    stream: { streamId: 's', cursor: '1' },
    type: 'text',
    payload: { channel: 'assistant', text },
  } as unknown as PersistedStreamEventEnvelope
}

describe('createStreamLoopContext', () => {
  describe('isStale', () => {
    it('is stale when the generation no longer matches expectedGen', () => {
      const ctx = createStreamLoopContext(
        makeStreamLoopDeps({ expectedGen: 1, streamGenRef: ref(2) })
      )
      expect(ctx.ops.isStale()).toBe(true)
    })

    it('is stale when shouldContinue returns false', () => {
      const ctx = createStreamLoopContext(
        makeStreamLoopDeps({
          expectedGen: 1,
          streamGenRef: ref(1),
          options: { shouldContinue: () => false },
        })
      )
      expect(ctx.ops.isStale()).toBe(true)
    })

    it('is not stale when the generation matches and shouldContinue is true', () => {
      const ctx = createStreamLoopContext(
        makeStreamLoopDeps({
          expectedGen: 1,
          streamGenRef: ref(1),
          options: { shouldContinue: () => true },
        })
      )
      expect(ctx.ops.isStale()).toBe(false)
    })

    it('is not stale when expectedGen is undefined (no generation guard)', () => {
      const ctx = createStreamLoopContext(
        makeStreamLoopDeps({ expectedGen: undefined, streamGenRef: ref(5) })
      )
      expect(ctx.ops.isStale()).toBe(false)
    })
  })

  describe('fresh (non-preserve) initialization', () => {
    it('resets the shared streaming refs when the stream is live', () => {
      const streamingContentRef = ref('leftover')
      const streamingBlocksRef = ref<ContentBlock[]>([{ type: 'text', content: 'old' }])
      createStreamLoopContext(
        makeStreamLoopDeps({
          expectedGen: 1,
          streamGenRef: ref(1),
          streamingContentRef,
          streamingBlocksRef,
        })
      )
      expect(streamingContentRef.current).toBe('')
      expect(streamingBlocksRef.current).toEqual([])
    })

    it('does NOT reset the shared refs when already stale (parity with the original ordering)', () => {
      const streamingContentRef = ref('live-content')
      const streamingBlocksRef = ref<ContentBlock[]>([{ type: 'text', content: 'live' }])
      // expectedGen !== streamGen => stale at construction time
      createStreamLoopContext(
        makeStreamLoopDeps({
          expectedGen: 1,
          streamGenRef: ref(2),
          streamingContentRef,
          streamingBlocksRef,
        })
      )
      expect(streamingContentRef.current).toBe('live-content')
      expect(streamingBlocksRef.current).toEqual([{ type: 'text', content: 'live' }])
    })
  })

  describe('preserveExistingState reconnect hydration', () => {
    it('rebuilds the model (tools and subagent lanes) from the persisted snapshot', () => {
      const blocks: ContentBlock[] = [
        { type: 'text', content: 'hi' },
        {
          type: 'tool_call',
          toolCall: {
            id: 'tc-1',
            name: 'read',
            status: ToolCallStatus.success,
            params: { path: '/a' },
          },
        },
        { type: 'subagent', content: 'file', spanId: 'span-1', parentToolCallId: 'tc-1' },
      ]
      const ctx = createStreamLoopContext(
        makeStreamLoopDeps({
          options: { preserveExistingState: true },
          streamingBlocksRef: ref<ContentBlock[]>(blocks),
          streamingContentRef: ref('hi'),
        })
      )
      const tool = ctx.state.model.nodes.get('tc-1')
      expect(tool?.kind).toBe('tool')
      expect((tool as { status: string }).status).toBe('success')
      const agent = ctx.state.model.nodes.get('span-1')
      expect(agent?.kind).toBe('agent')
      expect((agent as { agentId: string }).agentId).toBe('file')
    })

    it('rebuilds a closed subagent lane as terminal at a subagent_end marker', () => {
      const blocks: ContentBlock[] = [
        { type: 'subagent', content: 'file', spanId: 'span-1' },
        { type: 'subagent_end', spanId: 'span-1' },
      ]
      const ctx = createStreamLoopContext(
        makeStreamLoopDeps({
          options: { preserveExistingState: true },
          streamingBlocksRef: ref<ContentBlock[]>(blocks),
        })
      )
      const agent = ctx.state.model.nodes.get('span-1')
      expect(agent?.kind).toBe('agent')
      expect((agent as { status: string }).status).not.toBe('running')
    })

    it('does not clear the shared refs on a preserve-state stream', () => {
      const streamingContentRef = ref('keep')
      const streamingBlocksRef = ref<ContentBlock[]>([{ type: 'text', content: 'keep' }])
      createStreamLoopContext(
        makeStreamLoopDeps({
          options: { preserveExistingState: true },
          streamingContentRef,
          streamingBlocksRef,
        })
      )
      expect(streamingContentRef.current).toBe('keep')
    })
  })

  describe('flush', () => {
    it('no-ops when the stream is stale', () => {
      const setPendingMessages = vi.fn()
      const ctx = createStreamLoopContext(
        makeStreamLoopDeps({ expectedGen: 1, streamGenRef: ref(2), setPendingMessages })
      )
      ctx.ops.flush()
      expect(setPendingMessages).not.toHaveBeenCalled()
    })

    it('writes a pending-message snapshot when there is no chatId', () => {
      const setPendingMessages = vi.fn()
      const ctx = createStreamLoopContext(
        makeStreamLoopDeps({ chatIdRef: ref<string | undefined>(undefined), setPendingMessages })
      )
      // flush serializes the model (the single source of truth) into the snapshot.
      reduceEvent(ctx.state.model, textEnvelope('hello'))
      ctx.ops.flush()
      expect(setPendingMessages).toHaveBeenCalledTimes(1)
      const updater = setPendingMessages.mock.calls[0][0] as (prev: ChatMessage[]) => ChatMessage[]
      const result = updater([])
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({ id: 'assistant-1', role: 'assistant', content: 'hello' })
    })

    it('routes to mothership chat history when a chatId is present', () => {
      const upsertMothershipChatHistory = vi.fn()
      const ctx = createStreamLoopContext(
        makeStreamLoopDeps({
          chatIdRef: ref<string | undefined>('chat-1'),
          upsertMothershipChatHistory,
        })
      )
      ctx.state.runningText = 'hi'
      ctx.ops.flush()
      expect(upsertMothershipChatHistory).toHaveBeenCalledWith('chat-1', expect.any(Function))
    })
  })

  describe('flushText (node falls through to flush synchronously)', () => {
    it('no-ops when stale', () => {
      const setPendingMessages = vi.fn()
      const ctx = createStreamLoopContext(
        makeStreamLoopDeps({ expectedGen: 1, streamGenRef: ref(2), setPendingMessages })
      )
      ctx.ops.flushText()
      expect(setPendingMessages).not.toHaveBeenCalled()
    })
  })
})
