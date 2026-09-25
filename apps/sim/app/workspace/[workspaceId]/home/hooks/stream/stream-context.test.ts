import { describe, expect, it, vi } from 'vitest'
import type { ContentBlock } from '@/app/workspace/[workspaceId]/home/types'
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
  })

  describe('fresh (non-preserve) initialization', () => {
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
  })
})
