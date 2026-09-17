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
