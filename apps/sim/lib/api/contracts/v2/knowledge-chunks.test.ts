import { describe, expect, it } from 'vitest'
import { v2BulkKnowledgeChunksBodySchema } from '@/lib/api/contracts/v2/knowledge-chunks'

/**
 * This description is the only source of the `--chunk` flag help the CLI
 * generates, so it and the implementation must state the same rule. It used to
 * say unmatched ids were "ignored" while the response returned them in
 * `errors[]` — for two of the three operations.
 */
describe('v2 bulk knowledge chunk contract', () => {
  const description = v2BulkKnowledgeChunksBodySchema.shape.chunkIds.description ?? ''

  it('does not promise unmatched ids are ignored', () => {
    expect(description).not.toMatch(/ignored/i)
  })

  it('points at the field that reports unmatched ids', () => {
    expect(description).toMatch(/errors/)
  })
})
