#!/usr/bin/env bun
/**
 * Wraps existing `account` OAuth tokens in the `simenc:v1:` envelope.
 *
 * Once `oauth-token-encryption` is on, every token that is written or refreshed is
 * enveloped, so actively-used credentials convert on their own. Rows that are never
 * rewritten do not: a provider that issues no refresh token (GitHub classic, Shopify,
 * Trello) and a user who never signs in again both leave a row in plaintext forever.
 * This closes that tail.
 *
 * It is a manual script on purpose — it is deliberately NOT a `script-migration`, so it
 * never runs as part of `db:migrate` or a deploy. Self-hosted upgrades are unaffected by
 * its existence; nothing happens until someone runs it.
 *
 * Safety properties:
 *   - Dry run unless `--apply` is passed. Encryption is not reversible without the key,
 *     so the destructive direction is opt-in twice: run it, then mean it.
 *   - Refuses to start unless `ENCRYPTION_KEY` is usable and an AES-GCM round trip
 *     agrees with itself. A misconfigured deployment touches no rows.
 *   - Idempotent and resumable. Already-enveloped values are skipped, so re-running
 *     after an interruption continues rather than double-wrapping.
 *   - Compare-and-swap per row. A token rotated by a concurrent refresh between the read
 *     and the write is left alone and reported, never overwritten with the stale value.
 *   - Never writes `updated_at`. Slack's fan-out version guard, Instagram's minimum
 *     token age, connection ordering and "last connected" all read it.
 *
 * Usage:
 *   DATABASE_URL=... ENCRYPTION_KEY=... bun run scripts/backfill-account-token-encryption.ts
 *   DATABASE_URL=... ENCRYPTION_KEY=... bun run scripts/backfill-account-token-encryption.ts --apply
 *
 * Options: --apply  perform writes (default is a dry run)
 *          --batch=N        rows per page (default 500)
 *          --sleep=MS       pause between pages (default 250)
 */
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { and, asc, eq, gt, or, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import {
  ACCOUNT_TOKEN_FIELDS,
  type AccountTokenField,
  encryptAccountToken,
  fieldsNeedingEncryption,
} from '../apps/sim/lib/oauth/account-token-crypto'
import { account } from '../packages/db/schema'

type TokenRow = { id: string } & Record<AccountTokenField, string | null>

function parseNumberArg(name: string, fallback: number): number {
  const raw = process.argv.find((arg) => arg.startsWith(`--${name}=`))?.split('=')[1]
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

/** Fails before any row is read if this environment's AES-GCM does not round-trip. */
async function assertCryptoRoundTrip(): Promise<void> {
  const sample = 'account-token-backfill-round-trip'
  const enveloped = await encryptAccountToken(sample)
  if (!enveloped.startsWith('simenc:v1:')) {
    throw new Error(`Envelope prefix missing; got ${enveloped.slice(0, 16)}…`)
  }
  const { decryptAccountToken } = await import('../apps/sim/lib/oauth/account-token-crypto')
  const recovered = await decryptAccountToken(enveloped, 'accessToken')
  if (recovered !== sample) throw new Error('AES-GCM round trip did not return the input')
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  const batchSize = parseNumberArg('batch', 500)
  const sleepMs = parseNumberArg('sleep', 250)

  const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL
  if (!connectionString) {
    console.error('Missing DATABASE_URL (or POSTGRES_URL)')
    process.exit(1)
  }

  const key = process.env.ENCRYPTION_KEY
  if (!key || key.length !== 64 || !/^[0-9a-f]+$/i.test(key)) {
    console.error(
      'ENCRYPTION_KEY must be a 64-character hex string (32 bytes) — the same key the app runs with.\n' +
        'Nothing was read or written.'
    )
    process.exit(1)
  }

  try {
    await assertCryptoRoundTrip()
  } catch (error) {
    console.error(`Refusing to run: ${getErrorMessage(error)}\nNothing was read or written.`)
    process.exit(1)
  }

  if (!process.env.OAUTH_TOKEN_ENCRYPTION) {
    console.warn(
      'Note: OAUTH_TOKEN_ENCRYPTION is not set in this environment. On hosted deployments the\n' +
        'flag lives in AppConfig, so this is expected. On self-hosted it means new writes are\n' +
        'still plaintext — enable the flag first, or the table will drift back.\n'
    )
  }

  const client = postgres(connectionString, {
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 30,
    max: 3,
    onnotice: () => {},
  })
  const db = drizzle(client)

  /**
   * Pending when a token column holds a non-empty value that is not already one of our
   * envelopes. Matched as `simenc:v%` rather than `simenc:%` to stay aligned with
   * {@link isEncryptedAccountToken}: a legacy value that merely begins `simenc:` is not
   * ours, so it must still be selected and enveloped rather than skipped forever.
   */
  const pending = or(
    ...ACCOUNT_TOKEN_FIELDS.map((field) =>
      and(
        sql`${account[field]} IS NOT NULL`,
        sql`${account[field]} <> ''`,
        sql`${account[field]} NOT LIKE 'simenc:v%'`
      )
    )
  )

  const stats = { scanned: 0, updated: 0, raced: 0, failed: 0 }

  try {
    const [{ count: before }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(account)
      .where(pending)

    console.log(
      `${before} row(s) hold a plaintext token${apply ? '' : ' [DRY RUN — pass --apply to write]'}`
    )
    if (before === 0) return

    let cursor = ''
    for (;;) {
      const rows: TokenRow[] = await db
        .select({
          id: account.id,
          accessToken: account.accessToken,
          refreshToken: account.refreshToken,
          idToken: account.idToken,
        })
        .from(account)
        .where(and(gt(account.id, cursor), pending))
        .orderBy(asc(account.id))
        .limit(batchSize)

      if (rows.length === 0) break

      const lastId = rows[rows.length - 1].id
      if (lastId <= cursor) throw new Error(`Keyset cursor did not advance past ${cursor}`)
      cursor = lastId

      for (const row of rows) {
        stats.scanned += 1
        const fields = fieldsNeedingEncryption(row)
        if (fields.length === 0) continue

        try {
          const patch: Partial<Record<AccountTokenField, string>> = {}
          for (const field of fields) {
            patch[field] = await encryptAccountToken(row[field] as string)
          }

          if (!apply) {
            stats.updated += 1
            continue
          }

          /**
           * Guarded on the exact values just read, so a token rotated by a concurrent
           * refresh is left alone rather than reverted to the stale one. `updated_at` is
           * deliberately absent from the SET list.
           */
          const applied = await db
            .update(account)
            .set(patch)
            .where(
              and(
                eq(account.id, row.id),
                ...fields.map((field) => eq(account[field], row[field] as string))
              )
            )
            .returning({ id: account.id })

          if (applied.length === 0) stats.raced += 1
          else stats.updated += 1
        } catch (error) {
          stats.failed += 1
          console.error(`  row ${row.id}: ${getErrorMessage(error)}`)
        }
      }

      console.log(
        `  scanned=${stats.scanned} ${apply ? 'updated' : 'would-encrypt'}=${stats.updated} raced=${stats.raced} failed=${stats.failed}`
      )
      if (!apply) break
      if (sleepMs > 0) await sleep(sleepMs)
    }

    const [{ count: after }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(account)
      .where(pending)

    console.log(
      `\nDone. scanned=${stats.scanned} ${apply ? 'updated' : 'would-encrypt'}=${stats.updated} ` +
        `raced=${stats.raced} failed=${stats.failed} remaining=${after}`
    )
    if (apply && (stats.failed > 0 || after > 0)) {
      console.log('Re-run to pick up raced or remaining rows.')
      process.exitCode = 1
    }
  } finally {
    await client.end({ timeout: 5 }).catch(() => {})
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(`\nBackfill failed: ${getErrorMessage(error)}`)
    process.exit(1)
  })
}
