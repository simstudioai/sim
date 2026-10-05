import { type SQL, sql } from 'drizzle-orm'

/**
 * The pool uses fetch_types: false, so arrays must be constructed from scalar
 * parameters. A JSON scalar keeps large sets below PostgreSQL's bind limit.
 */
export function textArrayLiteral(values: readonly string[]): SQL {
  if (values.length > 1000) {
    return sql`ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(values)}::text::jsonb))`
  }
  return sql`ARRAY[${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `
  )}]::text[]`
}
