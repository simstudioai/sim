/**
 * Maps a knowledge base's stored vector width onto the one pgvector column that
 * holds it. Every read and write of a chunk's vector goes through here, so the
 * column choice, the distance expression, and the index each width is served by
 * can never drift apart.
 */

import { embedding } from '@sim/db/schema'
import { type SQL, sql } from 'drizzle-orm'
import type { KbEmbeddingDimensions } from '@/lib/knowledge/embedding-models'

type VectorField = 'embedding' | 'embedding384' | 'embedding768' | 'embedding1024' | 'embedding3072'

/**
 * Column per stored width. `embedding` is the original 1536 column, kept under
 * its bare name so rows written before the other widths existed stay put.
 */
const VECTOR_FIELD_BY_WIDTH = {
  384: 'embedding384',
  768: 'embedding768',
  1024: 'embedding1024',
  1536: 'embedding',
  3072: 'embedding3072',
} as const satisfies Record<KbEmbeddingDimensions, VectorField>

const VECTOR_FIELDS = Object.values(VECTOR_FIELD_BY_WIDTH) as readonly VectorField[]

export function embeddingVectorColumn(dimensions: KbEmbeddingDimensions) {
  return embedding[VECTOR_FIELD_BY_WIDTH[dimensions]]
}

/**
 * The vector slice of an `embedding` row: the column for this width carries the
 * vector and every other width is explicitly NULL.
 *
 * Every width is named rather than just the one in use so an update that
 * re-embeds a chunk at a different width clears the column it used to live in.
 * Omitting the others satisfies an insert but leaves an update holding two
 * vectors, which `embedding_width_check` rejects.
 */
export function embeddingVectorValues(
  dimensions: KbEmbeddingDimensions,
  vector: number[]
): Record<VectorField, number[] | null> {
  const target = VECTOR_FIELD_BY_WIDTH[dimensions]
  return Object.fromEntries(
    VECTOR_FIELDS.map((field) => [field, field === target ? vector : null])
  ) as Record<VectorField, number[] | null>
}

/**
 * Cosine distance between a chunk's vector and the query vector, in the exact
 * form the width's HNSW index was built on.
 *
 * The 3,072 column is compared through a `halfvec` cast because pgvector
 * indexes `vector` only up to 2,000 dimensions, so its index is on that cast
 * expression. Postgres matches an expression index by the expression, so a
 * plain `<=>` against the column here would silently drop to a sequential scan
 * — and the cast belongs here rather than at each call site precisely because
 * getting it wrong is invisible in the results and only shows up as latency.
 * `packages/db/schema.ts` records what the half-precision comparison costs.
 */
export function embeddingDistance(
  dimensions: KbEmbeddingDimensions,
  queryVector: string
): SQL<number> {
  if (dimensions === 3072) {
    return sql<number>`${embedding.embedding3072}::halfvec(3072) <=> ${queryVector}::halfvec(3072)`
  }
  return sql<number>`${embeddingVectorColumn(dimensions)} <=> ${queryVector}::vector`
}
