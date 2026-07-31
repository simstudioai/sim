/**
 * @vitest-environment node
 */

// Renders the real key-removal expression against the real drizzle dialect.
// utils.test.ts mocks drizzle wholesale, so its assertions passed against BOTH
// previously-broken forms (`- ${keys}::text[]` and `- ${sql.param(keys)}::text[]`).
// Only a real render can tell them apart, and only the params reveal an array bind:
// the app pools set `fetch_types: false` (packages/db/db.ts), which leaves
// postgres-js unable to serialize an array bound as a single parameter.
import { describe, expect, it, vi } from 'vitest'

vi.unmock('drizzle-orm')
vi.unmock('@sim/db')
vi.unmock('@sim/db/schema')

process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/test'

const { sql } = await import('drizzle-orm')
const { PgDialect } = await import('drizzle-orm/pg-core')

/** Mirrors the expression built in `updateWebhookProviderConfig`. */
function renderKeyRemoval(removedKeys: string[]) {
  const merged = sql`COALESCE("provider_config"::jsonb, '{}'::jsonb) || ${JSON.stringify({ a: 1 })}::jsonb`
  return new PgDialect().sqlToQuery(
    sql`(${merged}) - ARRAY[${sql.join(
      removedKeys.map((key) => sql`${key}`),
      sql`, `
    )}]::text[]`
  )
}

describe('provider-config key removal SQL', () => {
  // Production only ever removes one key (google-drive's pageToken reset), so the
  // single-element case is the one that actually runs.
  for (const keys of [['pageToken'], ['a', 'b'], ['a', 'b', 'c']]) {
    it(`binds ${keys.length} key(s) as scalars inside an ARRAY constructor`, () => {
      const { sql: text, params } = renderKeyRemoval(keys)

      expect(text).toContain(`ARRAY[${keys.map((_, i) => `$${i + 2}`).join(', ')}]::text[]`)
      expect(params).toEqual([JSON.stringify({ a: 1 }), ...keys])
      for (const param of params) {
        expect(Array.isArray(param)).toBe(false)
      }
    })
  }

  it('never renders a row constructor cast to text[]', () => {
    // `- ($1, $2)::text[]` — what interpolating the raw JS array produced. Postgres
    // rejects it: "cannot cast type record to text[]" (and 22P02 at one element).
    const { sql: text } = renderKeyRemoval(['a', 'b'])
    expect(text).not.toMatch(/\(\$\d+(, \$\d+)+\)::text\[\]/)
  })
})
