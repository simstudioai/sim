/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import {
  bindForkCopyEmbeddings,
  completeForkCopyResource,
  ForkCopyContinuation,
  type ForkCopyControl,
  type ForkCopyProgress,
} from '@/ee/workspace-forking/lib/copy/progress'

function control(): ForkCopyControl & { progress: ForkCopyProgress } {
  return {
    progress: { completed: [], tables: {}, embeddings: {} },
    checkpoint: vi.fn(async () => {}),
  }
}

describe('fork copy checkpoints', () => {
  it('binds a document generation durably before returning its first embedding cursor', async () => {
    const copy = control()
    await expect(bindForkCopyEmbeddings(copy, 'doc', 'kb', 'revision-1')).resolves.toBeNull()
    expect(copy.checkpoint).toHaveBeenCalledWith({
      completed: [],
      tables: {},
      embeddings: {
        doc: { afterId: null, knowledgeBaseId: 'kb', sourceRevision: 'revision-1' },
      },
    })
    copy.progress.embeddings.doc.afterId = 'chunk-8'
    await expect(bindForkCopyEmbeddings(copy, 'doc', 'kb', 'revision-1')).resolves.toBe('chunk-8')
    expect(copy.checkpoint).toHaveBeenCalledTimes(1)
  })

  it('refuses a changed source generation without discarding retained embeddings', async () => {
    const copy = control()
    await bindForkCopyEmbeddings(copy, 'doc', 'kb', 'revision-1')
    copy.progress.embeddings.doc.afterId = 'chunk-8'
    const prior = structuredClone(copy.progress)
    await expect(bindForkCopyEmbeddings(copy, 'doc', 'kb', 'revision-2')).rejects.toThrow(
      'changed after copying began'
    )
    expect(copy.progress).toEqual(prior)
    expect(copy.checkpoint).toHaveBeenCalledTimes(1)
  })

  it('retains knowledge base cursors until the whole base completes and prunes only that base', async () => {
    const copy = control()
    await bindForkCopyEmbeddings(copy, 'first', 'kb', 'revision-1')
    await bindForkCopyEmbeddings(copy, 'second', 'kb', 'revision-2')
    await bindForkCopyEmbeddings(copy, 'other', 'other-kb', 'revision-3')
    await completeForkCopyResource(copy, 'knowledge-base:kb')
    expect(copy.progress).toEqual({
      completed: ['knowledge-base:kb'],
      tables: {},
      embeddings: {
        other: { afterId: null, knowledgeBaseId: 'other-kb', sourceRevision: 'revision-3' },
      },
    })
  })

  it('prunes table and standalone document cursors with their completion markers', async () => {
    const copy = control()
    copy.progress.tables.table = { afterId: 'row', copied: 8, lastOrderKey: 'a' }
    await bindForkCopyEmbeddings(copy, 'doc', 'kb', 'revision-1')
    await completeForkCopyResource(copy, 'table:table')
    await completeForkCopyResource(copy, 'document:doc')
    await completeForkCopyResource(copy, 'document:doc')
    expect(copy.progress).toEqual({
      completed: ['table:table', 'document:doc'],
      tables: {},
      embeddings: {},
    })
  })

  it('does not start a new document when continuation or cancellation is due', async () => {
    const copy = control()
    copy.deadlineAt = Date.now()
    await expect(bindForkCopyEmbeddings(copy, 'doc', 'kb', 'revision')).rejects.toBeInstanceOf(
      ForkCopyContinuation
    )
    copy.signal = AbortSignal.abort(new Error('lease lost'))
    await expect(bindForkCopyEmbeddings(copy, 'doc', 'kb', 'revision')).rejects.toThrow(
      'lease lost'
    )
    expect(copy.checkpoint).not.toHaveBeenCalled()
  })
})
