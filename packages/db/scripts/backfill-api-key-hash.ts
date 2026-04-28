#!/usr/bin/env bun

/**
 * Backfills the `key_hash` column on the `api_key` table.
 *
 * The authentication hot path is being rewritten to look up API keys by the
 * SHA-256 hash of the plain-text key — a single indexed equality lookup rather
 * than a full-table scan + AES-GCM decrypt loop. This script populates
 * `key_hash` for every existing row so the new fast path can match historic
 * keys.
 *
 * For each row where `key_hash IS NULL`:
 *   - If `key` is in encrypted format (iv:encrypted:authTag), decrypt it using
 *     `API_ENCRYPTION_KEY` to recover the plain-text key.
 *   - Otherwise treat `key` as legacy plain text.
 *   - Compute `sha256(plainKey)` and update the row.
 *
 * The script is idempotent: it only touches rows where `key_hash IS NULL`, and
 * re-running after a partial failure continues where it left off.
 *
 * Usage:
 *   POSTGRES_URL=... API_ENCRYPTION_KEY=... \
 *     bun run packages/db/scripts/backfill-api-key-hash.ts
 *   # or
 *   POSTGRES_URL=... API_ENCRYPTION_KEY=... \
 *     bun run packages/db/scripts/backfill-api-key-hash.ts --dry-run
 */

import { createCipheriv, createDecipheriv, createHash } from 'crypto'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { apiKey } from '../schema'

const BATCH_SIZE = 500

export function isEncryptedKey(storedKey: string): boolean {
  return storedKey.includes(':') && storedKey.split(':').length === 3
}

export function hashApiKey(plainKey: string): string {
  return createHash('sha256').update(plainKey, 'utf8').digest('hex')
}

function decryptApiKey(encryptedValue: string, apiEncryptionKey: string): string {
  const parts = encryptedValue.split(':')
  if (parts.length !== 3) {
    return encryptedValue
  }

  const key = Buffer.from(apiEncryptionKey, 'hex')
  const [ivHex, encrypted, authTagHex] = parts
  if (!ivHex || !encrypted || !authTagHex) {
    throw new Error('Invalid encrypted api_key format. Expected "iv:encrypted:authTag"')
  }

  const iv = Buffer.from(ivHex, 'hex')
  const authTag = Buffer.from(authTagHex, 'hex')

  const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 })
  decipher.setAuthTag(authTag)

  let decrypted = decipher.update(encrypted, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}

/**
 * Computes the hash to write to `key_hash` for a row during backfill. Pure:
 * no I/O, no globals — safe to import from tests. Throws when the stored
 * value looks encrypted but the caller has no encryption key.
 */
export function deriveKeyHashForStoredKey(
  storedKey: string,
  apiEncryptionKey: string | null
): string {
  if (isEncryptedKey(storedKey)) {
    if (!apiEncryptionKey) {
      throw new Error('API_ENCRYPTION_KEY is required to decrypt an encrypted stored key')
    }
    return hashApiKey(decryptApiKey(storedKey, apiEncryptionKey))
  }
  return hashApiKey(storedKey)
}

interface BackfillStats {
  scanned: number
  updated: number
  skippedEncryptedNoKey: number
  failed: number
}

export async function runBackfill(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run')

  const connectionString = process.env.POSTGRES_URL ?? process.env.DATABASE_URL
  if (!connectionString) {
    console.error('Missing POSTGRES_URL or DATABASE_URL environment variable')
    process.exit(1)
  }

  const apiEncryptionKey = process.env.API_ENCRYPTION_KEY ?? null
  if (!apiEncryptionKey) {
    console.warn(
      'API_ENCRYPTION_KEY is not set. Rows whose stored key is encrypted will fail to decrypt. ' +
        'Only rows whose stored key is already plain text will be backfilled in this run.'
    )
  } else if (apiEncryptionKey.length !== 64) {
    console.error('API_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)')
    process.exit(1)
  }

  assertCryptoRoundTrip(apiEncryptionKey)

  const postgresClient = postgres(connectionString, {
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 30,
    max: 5,
    onnotice: () => {},
  })
  const db = drizzle(postgresClient)

  const stats: BackfillStats = {
    scanned: 0,
    updated: 0,
    skippedEncryptedNoKey: 0,
    failed: 0,
  }

  try {
    const [{ count: pendingBefore }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(apiKey)
      .where(isNull(apiKey.keyHash))

    console.log(
      `Backfill starting — ${pendingBefore} row(s) with NULL key_hash${dryRun ? ' [DRY RUN]' : ''}`
    )

    for (;;) {
      const rows = await db
        .select({ id: apiKey.id, key: apiKey.key })
        .from(apiKey)
        .where(isNull(apiKey.keyHash))
        .limit(BATCH_SIZE)

      if (rows.length === 0) break

      await Promise.all(
        rows.map(async (row) => {
          stats.scanned += 1
          try {
            if (isEncryptedKey(row.key) && !apiEncryptionKey) {
              stats.skippedEncryptedNoKey += 1
              return
            }

            const keyHash = deriveKeyHashForStoredKey(row.key, apiEncryptionKey)

            if (dryRun) {
              stats.updated += 1
              return
            }

            await db
              .update(apiKey)
              .set({ keyHash })
              .where(and(eq(apiKey.id, row.id), isNull(apiKey.keyHash)))

            stats.updated += 1
          } catch (error) {
            stats.failed += 1
            console.error(
              `Failed to backfill api_key id=${row.id}: ${error instanceof Error ? error.message : String(error)}`
            )
          }
        })
      )

      console.log(
        `  progress: scanned=${stats.scanned} updated=${stats.updated} skipped=${stats.skippedEncryptedNoKey} failed=${stats.failed}`
      )
      if (dryRun) break
    }

    const [{ count: pendingAfter }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(apiKey)
      .where(isNull(apiKey.keyHash))

    console.log('Backfill complete.')
    console.log(`  scanned:              ${stats.scanned}`)
    console.log(`  updated:              ${stats.updated}`)
    console.log(`  skipped (no api key): ${stats.skippedEncryptedNoKey}`)
    console.log(`  failed:               ${stats.failed}`)
    console.log(`  remaining null:       ${pendingAfter}`)

    if (stats.failed > 0 || pendingAfter > 0) {
      process.exitCode = 1
    }
  } finally {
    await postgresClient.end({ timeout: 5 }).catch(() => {})
  }
}

/** Fails fast if the AES-GCM round-trip disagrees with itself in this env. */
function assertCryptoRoundTrip(apiEncryptionKey: string | null): void {
  if (!apiEncryptionKey) return
  const key = Buffer.from(apiEncryptionKey, 'hex')
  const sample = 'sk-sim-roundtrip-test-value'
  const iv = Buffer.from('00'.repeat(16), 'hex')
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 })
  let encrypted = cipher.update(sample, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const authTag = cipher.getAuthTag()
  const assembled = `${iv.toString('hex')}:${encrypted}:${authTag.toString('hex')}`
  const roundTripped = decryptApiKey(assembled, apiEncryptionKey)
  if (roundTripped !== sample) {
    throw new Error('Crypto self-test failed — refusing to run backfill')
  }
}

if ((import.meta as { main?: boolean }).main) {
  try {
    await runBackfill()
  } catch (error) {
    console.error('Backfill aborted:', error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
