import { type SQLWrapper, sql } from 'drizzle-orm'
import type { CompiledFileSearchPattern } from '@/lib/workspace-files/search/pattern'

export function buildMatchExpression(
  content: SQLWrapper,
  pattern: CompiledFileSearchPattern,
  multiline = false
) {
  if (pattern.mode === 'regex') {
    const source = multiline ? `(?n)${pattern.sqlPattern}` : pattern.sqlPattern
    return pattern.caseSensitive ? sql`${content} ~ ${source}` : sql`${content} ~* ${source}`
  }
  return pattern.caseSensitive
    ? sql`${content} LIKE ${pattern.sqlPattern} ESCAPE '\\'`
    : sql`${content} ILIKE ${pattern.sqlPattern} ESCAPE '\\'`
}

/** Maps a case-folded match back to original character offsets without expanding a line into rows. */
export function buildLiteralMatchStart(
  content: SQLWrapper,
  literal: string,
  caseSensitive: boolean
) {
  if (caseSensitive) return sql<number>`strpos(${content}, ${literal})`
  return sql<number>`(
    WITH RECURSIVE position AS MATERIALIZED (
      SELECT strpos(lower(${content}), lower(${literal})) AS folded_start,
        char_length(${content}) AS original_length,
        char_length(lower(${content})) AS folded_length
    ), bounds(low, high) AS (
      SELECT 0, original_length FROM position
      WHERE folded_start > 0 AND original_length <> folded_length
      UNION ALL
      SELECT
        CASE WHEN char_length(lower(substring(${content} FROM 1 FOR (low + high + 1) / 2))) < folded_start
          THEN (low + high + 1) / 2 ELSE low END,
        CASE WHEN char_length(lower(substring(${content} FROM 1 FOR (low + high + 1) / 2))) < folded_start
          THEN high ELSE (low + high + 1) / 2 - 1 END
      FROM bounds CROSS JOIN position WHERE low < high
    )
    SELECT CASE WHEN original_length = folded_length OR folded_start = 0 THEN folded_start
      ELSE (SELECT low + 1 FROM bounds WHERE low = high) END FROM position
  )`
}
