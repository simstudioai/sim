import { sealAccountTokens } from '@sim/db/script-migrations/0037_seal_account_tokens'
import { openText } from '@sim/db/sealed-text'
import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { seal, sealingKeyId } from '@sim/security/encryption'
import { generateId } from '@sim/utils/id'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const databaseUrl = readTestDatabaseUrl()
const KEY_HEX = 'a'.repeat(64)
const KEY_ID = sealingKeyId(Buffer.from(KEY_HEX, 'hex'))
const ACCESS_CONTEXT = 'account.access_token'
const REFRESH_CONTEXT = 'account.refresh_token'

interface StoredRow {
  id: string
  access_token: string | null
  refresh_token: string | null
  updated_at: string
}

/** Copies the account table into an isolated disposable schema; no public rows are touched. */
describe('sealing stored account tokens in PostgreSQL', () => {
  let sql: Sql
  let admin: Sql
  const schemaName = `account_sealing_${generateId().replaceAll('-', '')}`
  const previousKey = process.env.ENCRYPTION_KEY

  beforeAll(async () => {
    process.env.ENCRYPTION_KEY = KEY_HEX
    admin = postgres(databaseUrl, { max: 1, onnotice: () => undefined })
    await admin.unsafe(`CREATE SCHEMA "${schemaName}"`)
    await admin.unsafe(
      `CREATE TABLE "${schemaName}"."account" (LIKE public."account" INCLUDING DEFAULTS)`
    )
    sql = postgres(databaseUrl, {
      max: 2,
      connection: { search_path: schemaName },
      onnotice: () => undefined,
    })
  })

  afterAll(async () => {
    if (previousKey === undefined) Reflect.deleteProperty(process.env, 'ENCRYPTION_KEY')
    else process.env.ENCRYPTION_KEY = previousKey
    await sql?.end()
    if (admin) {
      await admin.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
      await admin.end()
    }
  })

  beforeEach(async () => {
    await sql`TRUNCATE account`
  })

  async function insertAccount(accessToken: string | null, refreshToken: string | null) {
    const id = generateId()
    await sql`INSERT INTO account (id, account_id, provider_id, user_id, access_token, refresh_token, created_at, updated_at)
      VALUES (${id}, ${`subject-${id}`}, 'google-drive', ${`user-${id}`}, ${accessToken}, ${refreshToken},
        '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`
    return id
  }

  async function storedRows() {
    return sql<StoredRow[]>`
      SELECT id, access_token, refresh_token, updated_at::text FROM account ORDER BY id`
  }

  it('seals every stored token across batches without moving the chain version', async () => {
    await Promise.all(
      Array.from({ length: 5 }, (_, index) => insertAccount(`access-${index}`, `refresh-${index}`))
    )
    const accessOnly = await insertAccount('access-only', null)
    const before = await storedRows()

    expect(
      await sealAccountTokens(sql, {
        mode: 'seal',
        expectedKeyId: KEY_ID,
        batchSize: 2,
        pauseMs: 0,
      })
    ).toEqual({
      keyId: KEY_ID,
      scanned: 6,
      pending: 6,
      updated: 6,
      foreignKey: 0,
    })

    const after = await storedRows()
    for (const row of after) {
      const original = before.find((candidate) => candidate.id === row.id)
      expect(row.updated_at).toBe(original?.updated_at)
      expect(row.access_token).toMatch(/^enc:v1:/)
      expect(openText(row.access_token ?? '', ACCESS_CONTEXT)).toBe(original?.access_token)
      if (row.id === accessOnly) {
        expect(row.refresh_token).toBeNull()
      } else {
        expect(row.refresh_token).toMatch(/^enc:v1:/)
        expect(openText(row.refresh_token ?? '', REFRESH_CONTEXT)).toBe(original?.refresh_token)
      }
    }
  })

  it('finds nothing left to do on a rerun or a dry run after a completed pass', async () => {
    await insertAccount('access', 'refresh')
    await sealAccountTokens(sql, { mode: 'seal', expectedKeyId: KEY_ID, pauseMs: 0 })
    const sealed = await storedRows()

    expect(
      await sealAccountTokens(sql, { mode: 'seal', expectedKeyId: KEY_ID, pauseMs: 0 })
    ).toMatchObject({
      pending: 0,
      updated: 0,
    })
    expect(
      await sealAccountTokens(sql, {
        mode: 'seal',
        expectedKeyId: KEY_ID,
        dryRun: true,
        pauseMs: 0,
      })
    ).toMatchObject({
      pending: 0,
    })
    expect(await storedRows()).toEqual(sealed)
  })

  it('reports pending rows on a dry run without writing them', async () => {
    await insertAccount('access', 'refresh')
    const before = await storedRows()

    expect(
      await sealAccountTokens(sql, {
        mode: 'seal',
        expectedKeyId: KEY_ID,
        dryRun: true,
        pauseMs: 0,
      })
    ).toEqual({
      keyId: KEY_ID,
      scanned: 1,
      pending: 1,
      updated: 0,
      foreignKey: 0,
    })
    expect(await storedRows()).toEqual(before)
  })

  it('restores the exact plaintext when unsealing for a rollback', async () => {
    await insertAccount('ya29.access:with:colons', 'refresh')
    await insertAccount(null, 'refresh-only')
    const plaintext = await storedRows()
    await sealAccountTokens(sql, { mode: 'seal', expectedKeyId: KEY_ID, pauseMs: 0 })

    expect(
      await sealAccountTokens(sql, { mode: 'unseal', expectedKeyId: KEY_ID, pauseMs: 0 })
    ).toMatchObject({
      updated: 2,
    })
    expect(await storedRows()).toEqual(plaintext)
  })

  it('refuses to start under a key the fleet does not use, before touching any row', async () => {
    await insertAccount('access', 'refresh')
    const before = await storedRows()

    for (const dryRun of [false, true]) {
      await expect(
        sealAccountTokens(sql, { mode: 'seal', expectedKeyId: 'ffffffff', dryRun, pauseMs: 0 })
      ).rejects.toThrow(KEY_ID)
    }
    await expect(sealAccountTokens(sql, { mode: 'seal', pauseMs: 0 })).rejects.toThrow()
    expect(await storedRows()).toEqual(before)
  })

  it('skips and reports rows sealed under another key instead of failing the pass', async () => {
    const otherKey = Buffer.from('b'.repeat(64), 'hex')
    const foreignAccess = seal('foreign-access', otherKey, ACCESS_CONTEXT)
    const foreign = await insertAccount(foreignAccess, 'foreign-refresh')
    await insertAccount('own-access', 'own-refresh')
    await sealAccountTokens(sql, { mode: 'seal', expectedKeyId: KEY_ID, pauseMs: 0 })

    expect(
      await sealAccountTokens(sql, { mode: 'unseal', expectedKeyId: KEY_ID, pauseMs: 0 })
    ).toMatchObject({ scanned: 2, updated: 1, foreignKey: 1 })
    const rows = await storedRows()
    expect(rows.find((row) => row.id === foreign)).toMatchObject({
      access_token: foreignAccess,
      refresh_token: 'foreign-refresh',
    })
    expect(rows.find((row) => row.id !== foreign)).toMatchObject({
      access_token: 'own-access',
      refresh_token: 'own-refresh',
    })
  })
})
