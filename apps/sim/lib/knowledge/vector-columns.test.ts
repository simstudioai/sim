import { describe, expect, it } from 'vitest'
import { KB_EMBEDDING_STORAGE_DIMENSIONS } from '@/lib/embeddings/catalog'
import {
  embeddingDistance,
  embeddingVectorColumn,
  embeddingVectorValues,
} from '@/lib/knowledge/vector-columns'

describe('embeddingVectorColumn', () => {
  it('keeps 1536 on the original bare `embedding` column, where existing rows live', () => {
    expect(embeddingVectorColumn(1536)).toBe('embedding.embedding')
  })
})

describe('embeddingVectorValues', () => {
  const vector = [0.1, 0.2]

  it('nulls every other width, so a re-embed at a new width clears the old column', () => {
    for (const width of KB_EMBEDDING_STORAGE_DIMENSIONS) {
      const values = embeddingVectorValues(width, vector)
      const populated = Object.entries(values).filter(([, value]) => value !== null)
      expect(populated, `${width} populated ${populated.length} columns`).toHaveLength(1)
      expect(Object.values(values).filter((value) => value === null)).toHaveLength(
        KB_EMBEDDING_STORAGE_DIMENSIONS.length - 1
      )
    }
  })
})

describe('embeddingDistance', () => {
  it('compares 3072 through the halfvec cast its expression index was built on', () => {
    expect(embeddingDistance(3072, '[1,2]').toSQL().sql).toContain('::halfvec(3072)')
  })
})
