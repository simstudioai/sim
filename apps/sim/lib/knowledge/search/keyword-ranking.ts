import { document, type embedding, type embeddingKeywordSearch } from '@sim/db/schema'
import { and, type SQL, sql } from 'drizzle-orm'

/**
 * A keyword ranking in three materialized steps: the chunks matching the query (identifiers
 * only), the documents among them the reader may read, and the ranking of the readable matches.
 * Deciding readability once per matched document rather than once per matched chunk, and ranking
 * only readable matches, keeps a common term from paying the full access predicate and a
 * text-search vector per match before the `LIMIT` applies.
 *
 * Restricting the documents with `document.id = ANY (ARRAY(...))` rather than a subquery keeps the
 * narrowed lookup on a bitmap scan, which prefetches, where a plain `IN (SELECT ...)` plans as an
 * index walk that does not.
 */
export function keywordCandidateRankingQuery(input: {
  /** Selects `id` and `document_id` of every chunk matching the query. */
  matchedChunks: SQL
  /** What a matched document must satisfy to be readable. */
  documentConditions: (SQL | undefined)[]
  /** The table whose text-search vector `rank` reads, joined to the matches on `id`. */
  rankTable: typeof embedding | typeof embeddingKeywordSearch
  rank: SQL<number>
  limit: number
  offset: number
}): SQL {
  return sql`
          WITH matched_keyword_chunks AS MATERIALIZED (${input.matchedChunks}
          ), visible_keyword_documents AS MATERIALIZED (
            SELECT ${document.id} AS id FROM ${document}
            WHERE ${and(
              sql`${document.id} = ANY (ARRAY(SELECT document_id FROM matched_keyword_chunks))`,
              ...input.documentConditions
            )}
          ), ranked_keyword_candidates AS MATERIALIZED (
            SELECT matched_keyword_chunks.id, matched_keyword_chunks.document_id,
              ${input.rank} AS keyword_rank
            FROM matched_keyword_chunks INNER JOIN ${input.rankTable}
              ON ${input.rankTable.id} = matched_keyword_chunks.id
            WHERE matched_keyword_chunks.document_id IN (SELECT id FROM visible_keyword_documents)
            ORDER BY keyword_rank DESC, matched_keyword_chunks.id
            LIMIT ${input.limit} OFFSET ${input.offset}
          )
          SELECT ranked_keyword_candidates.id, ${document.id} AS "documentId",
            ${document.connectorId} AS "connectorId"
          FROM ranked_keyword_candidates INNER JOIN ${document}
            ON ${document.id} = ranked_keyword_candidates.document_id
          ORDER BY ranked_keyword_candidates.keyword_rank DESC, ranked_keyword_candidates.id
        `
}
