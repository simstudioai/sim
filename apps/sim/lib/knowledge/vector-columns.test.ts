/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { KB_EMBEDDING_STORAGE_DIMENSIONS } from '@/lib/embeddings/catalog'
import {
  embeddingCandidateDistance,
  embeddingDistance,
  embeddingVectorColumn,
  embeddingVectorValues,
} from '@/lib/knowledge/vector-columns'

describe('embeddingVectorColumn', () => {
  it('maps every storable width to a distinct column', () => {
    const columns = KB_EMBEDDING_STORAGE_DIMENSIONS.map((width) => embeddingVectorColumn(width))
    expect(new Set(columns).size).toBe(KB_EMBEDDING_STORAGE_DIMENSIONS.length)
  })

  it('keeps 1536 on the original bare `embedding` column, where existing rows live', () => {
    expect(embeddingVectorColumn(1536)).toBe('embedding.embedding')
  })
})

describe('embeddingCandidateDistance', () => {
  it('matches the compact expression index for every stored width', () => {
    for (const width of KB_EMBEDDING_STORAGE_DIMENSIONS) {
      const rendered = embeddingCandidateDistance(width, '[1,2]').toSQL()
      expect(rendered.sql).toContain('binary_quantize(?)::bit(?) <~>')
      expect(rendered.params[0]).toBe(embeddingVectorColumn(width))
      expect(rendered.params[1]).toEqual(rendered.params[3])
      expect(JSON.stringify(rendered.params[1])).toContain(String(width))
      expect(rendered.params[2]).toBe('[1,2]')
      expect(rendered.sql).not.toContain('<=>')
    }
  })
})

describe('embeddingVectorValues', () => {
  const vector = [0.1, 0.2]

  it('writes the vector to the column its width belongs to', () => {
    expect(embeddingVectorValues(768, vector)).toMatchObject({ embedding768: vector })
  })

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

  it('compares every indexable width against a plain vector', () => {
    for (const width of KB_EMBEDDING_STORAGE_DIMENSIONS.filter((size) => size <= 2000)) {
      const rendered = embeddingDistance(width, '[1,2]').toSQL().sql
      expect(rendered, `${width} should not cast to halfvec`).not.toContain('halfvec')
      expect(rendered).toContain('::vector')
    }
  })
})
