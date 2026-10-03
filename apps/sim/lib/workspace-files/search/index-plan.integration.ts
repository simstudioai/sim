import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { estimateTrigramKeys } from '@/lib/workspace-files/search/index-plan'

describe('trigram key estimate against pg_trgm', () => {
  const databaseUrl = readTestDatabaseUrl()
  const connection = postgres(databaseUrl, { max: 1, onnotice: () => {} })

  beforeAll(async () => {
    await connection`CREATE EXTENSION IF NOT EXISTS pg_trgm`
  })

  afterAll(async () => {
    await connection.end()
  })

  it('runs where the estimate is specified', async () => {
    const [{ ctype }] = await connection<{ ctype: string }[]>`
      SELECT datctype AS ctype FROM pg_database WHERE datname = current_database()`
    expect(ctype).toMatch(/^en_US\.utf-?8$/i)
  })

  it.each([
    ['prose', 'The quick brown fox jumps over the lazy dog. The dog sleeps.'],
    ['identifiers', 'snake_case CamelCase kebab-case 123abc x86_64 v2.1.0'],
    ['a lockfile hash', '"sha512-cjQ7ZlQ0Mv3b47hABuTevyTuYN4i+loJKGeV9flcCgIK37cCXRh+L1bd=="'],
    ['accented text', 'Café naïve ÉCOLE über straße'],
    ['CJK text', '日本語のテキスト検索 テスト'],
    ['Greek text', 'Ελληνικά κείμενα ΑΒΓ'],
    ['emoji', 'emoji 🙂🙂 party 🎉 done'],
    ['punctuation only', '--- ___ ... !!!'],
  ])('matches show_trgm for %s', async (_, text) => {
    const [{ keys }] = await connection<{ keys: number }[]>`
      SELECT coalesce(array_length(show_trgm(${text}), 1), 0)::int AS keys`
    expect(estimateTrigramKeys(text)).toBe(keys)
  })
})
