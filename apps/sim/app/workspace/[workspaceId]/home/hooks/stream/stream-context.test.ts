/**
 * @vitest-environment node
 */

import { describe, expect, it, vi } from 'vitest'
import type { MothershipStreamV1ErrorPayload } from '@/lib/copilot/generated/mothership-stream-v1'
import type { ChatMessage, ContentBlock } from '@/app/workspace/[workspaceId]/home/types'
import { ToolCallStatus } from '@/app/workspace/[workspaceId]/home/types'
import { createStreamLoopContext } from './stream-context'
import { makeStreamLoopDeps, ref } from './stream-test-helpers'

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
    it('rebuilds blocks, toolMap, toolArgsMap, subagentBySpanId and recovers the active subagent', () => {
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
      expect(ctx.state.blocks).toHaveLength(3)
      expect(ctx.state.runningText).toBe('hi')
      expect(ctx.state.toolMap.get('tc-1')).toBe(1)
      expect(ctx.state.toolArgsMap.get('tc-1')).toEqual({ path: '/a' })
      expect(ctx.state.subagentBySpanId.get('span-1')).toBe('file')
      expect(ctx.state.activeSubagent).toBe('file')
      expect(ctx.state.activeSubagentParentToolCallId).toBe('tc-1')
    })

    it('stops recovering the active subagent at a subagent_end marker', () => {
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
      expect(ctx.state.activeSubagent).toBeUndefined()
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
      ctx.state.blocks.push({ type: 'text', content: 'x' })
      ctx.ops.flush()
      expect(setPendingMessages).not.toHaveBeenCalled()
    })

    it('writes a pending-message snapshot when there is no chatId', () => {
      const setPendingMessages = vi.fn()
      const ctx = createStreamLoopContext(
        makeStreamLoopDeps({ chatIdRef: ref<string | undefined>(undefined), setPendingMessages })
      )
      ctx.state.runningText = 'hello'
      ctx.state.blocks.push({ type: 'text', content: 'hello' })
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

  describe('block builders', () => {
    it('ensureTextBlock coalesces consecutive same-scope text blocks', () => {
      const ctx = createStreamLoopContext(makeStreamLoopDeps())
      const a = ctx.ops.ensureTextBlock(undefined, undefined, undefined, {})
      const b = ctx.ops.ensureTextBlock(undefined, undefined, undefined, {})
      expect(a).toBe(b)
      expect(ctx.state.blocks).toHaveLength(1)
    })

    it('ensureTextBlock starts a new block on a subagent-scope change and stamps the prior end', () => {
      const ctx = createStreamLoopContext(makeStreamLoopDeps())
      const main = ctx.ops.ensureTextBlock(undefined, undefined, undefined, {})
      const sub = ctx.ops.ensureTextBlock('file', undefined, undefined, { spanId: 's1' })
      expect(sub).not.toBe(main)
      expect(ctx.state.blocks).toHaveLength(2)
      expect(main.endedAt).toBeTypeOf('number')
      expect(sub.spanId).toBe('s1')
      expect(sub.subagent).toBe('file')
    })

    it('ensureThinkingBlock uses subagent_thinking under a subagent', () => {
      const ctx = createStreamLoopContext(makeStreamLoopDeps())
      const tb = ctx.ops.ensureThinkingBlock('file', 'tc', undefined, {})
      expect(tb.type).toBe('subagent_thinking')
    })

    it('toEventMs falls back to a finite now on an invalid timestamp', () => {
      const ctx = createStreamLoopContext(makeStreamLoopDeps())
      const ms = ctx.ops.toEventMs('not-a-date')
      expect(Number.isFinite(ms)).toBe(true)
    })

    it('resolveScopedSubagent prefers agentId, then spanId, then parentToolCallId, then active', () => {
      const ctx = createStreamLoopContext(makeStreamLoopDeps())
      ctx.state.subagentBySpanId.set('s1', 'spanAgent')
      ctx.state.subagentByParentToolCallId.set('p1', 'parentAgent')
      ctx.state.activeSubagent = 'activeAgent'
      expect(ctx.ops.resolveScopedSubagent('explicit', 'p1', 's1')).toBe('explicit')
      expect(ctx.ops.resolveScopedSubagent(undefined, 'p1', 's1')).toBe('spanAgent')
      expect(ctx.ops.resolveScopedSubagent(undefined, 'p1', undefined)).toBe('parentAgent')
      expect(ctx.ops.resolveScopedSubagent(undefined, undefined, undefined)).toBe('activeAgent')
    })

    it('buildInlineErrorTag includes the message, code and provider', () => {
      const ctx = createStreamLoopContext(makeStreamLoopDeps())
      const tag = ctx.ops.buildInlineErrorTag({
        message: 'boom',
        code: 'E1',
        provider: 'openai',
      } as unknown as MothershipStreamV1ErrorPayload)
      expect(tag).toContain('mothership-error')
      expect(tag).toContain('boom')
      expect(tag).toContain('E1')
      expect(tag).toContain('openai')
    })
  })
})
