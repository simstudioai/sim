import { account } from '@sim/db/schema'
import { openText, readEncryptionKey, sealedTextContext, sealText } from '@sim/db/sealed-text'
import { createLogger } from '@sim/logger'
import { sealedKeyId, sealingKeyId } from '@sim/security/encryption'
import { sleep } from '@sim/utils/helpers'
import type { Sql } from 'postgres'

const logger = createLogger('AccountTokenSealing', { enabled: true, logLevel: 'INFO' })

interface AccountTokenSealingOptions {
  mode: 'seal' | 'unseal'
  /**
   * The id the fleet logs at startup (`Account token sealing`). A pass refuses to start under any
   * other `ENCRYPTION_KEY`, so it can never seal rows with a key the fleet cannot open. Optional
   * only for a dry run.
   */
  expectedKeyId?: string
  /** Counts the rows that would change without writing any. */
  dryRun?: boolean
  batchSize?: number
  /** Pause between batches, which keeps the backfill off the write path's latency. */
  pauseMs?: number
}

interface AccountTokenSealingResult {
  keyId: string
  scanned: number
  pending: number
  updated: number
  /** Rows left untouched because a token is sealed under another key. */
  foreignKey: number
}

interface StoredTokens {
  id: string
  access_token: string | null
  refresh_token: string | null
}

const ACCESS_TOKEN_CONTEXT = sealedTextContext(account.accessToken)
const REFRESH_TOKEN_CONTEXT = sealedTextContext(account.refreshToken)

/**
 * Rewrites `account.access_token` and `account.refresh_token` into the sealed form (`seal`) or back
 * to plaintext (`unseal`, the rollback). Idempotent and resumable: a value already in the target
 * form is skipped, so a rerun only finishes what an interrupted run left. Each row is rewritten only
 * while it still holds the value this pass read, so a refresh that rotates the chain concurrently
 * wins, and `updated_at` is left alone because the refresh path reads it as the chain version. Rows
 * sealed under another key are skipped and counted rather than failing the pass.
 */
export async function sealAccountTokens(
  sql: Sql,
  {
    mode,
    expectedKeyId,
    dryRun = false,
    batchSize = 200,
    pauseMs = 100,
  }: AccountTokenSealingOptions
): Promise<AccountTokenSealingResult> {
  const keyId = sealingKeyId(readEncryptionKey())
  if ((!dryRun || expectedKeyId !== undefined) && expectedKeyId !== keyId) {
    throw new Error(
      `ENCRYPTION_KEY has key id ${keyId}, not the expected ${expectedKeyId ?? '(none)'}`
    )
  }
  const isForeign = (value: string | null) => {
    const sealedUnder = value === null ? null : sealedKeyId(value)
    return sealedUnder !== null && sealedUnder !== keyId
  }
  const convert = (value: string | null, context: string) =>
    value === null ? null : mode === 'seal' ? sealText(value, context) : openText(value, context)
  const result: AccountTokenSealingResult = {
    keyId,
    scanned: 0,
    pending: 0,
    updated: 0,
    foreignKey: 0,
  }
  let afterId = ''

  for (;;) {
    const rows = await sql<StoredTokens[]>`
      SELECT id, access_token, refresh_token FROM account
      WHERE id > ${afterId} AND (access_token IS NOT NULL OR refresh_token IS NOT NULL)
      ORDER BY id LIMIT ${batchSize}
    `
    if (rows.length === 0) break
    afterId = rows[rows.length - 1].id
    result.scanned += rows.length

    const ownRows = rows.filter(
      (row) => !isForeign(row.access_token) && !isForeign(row.refresh_token)
    )
    result.foreignKey += rows.length - ownRows.length
    const changes = ownRows
      .map((row) => ({
        row,
        accessToken: convert(row.access_token, ACCESS_TOKEN_CONTEXT),
        refreshToken: convert(row.refresh_token, REFRESH_TOKEN_CONTEXT),
      }))
      .filter(
        ({ row, accessToken, refreshToken }) =>
          accessToken !== row.access_token || refreshToken !== row.refresh_token
      )
    result.pending += changes.length

    if (changes.length > 0 && !dryRun) {
      const updated = await sql.begin(async (tx) => {
        await tx`SELECT set_config('lock_timeout', '5s', true),
          set_config('statement_timeout', '30s', true)`
        return tx<{ id: string }[]>`
          UPDATE account
          SET access_token = change.access_token, refresh_token = change.refresh_token
          FROM unnest(
            ${changes.map((change) => change.row.id)}::text[],
            ${changes.map((change) => change.row.access_token)}::text[],
            ${changes.map((change) => change.row.refresh_token)}::text[],
            ${changes.map((change) => change.accessToken)}::text[],
            ${changes.map((change) => change.refreshToken)}::text[]
          ) AS change(id, stored_access_token, stored_refresh_token, access_token, refresh_token)
          WHERE account.id = change.id
            AND account.access_token IS NOT DISTINCT FROM change.stored_access_token
            AND account.refresh_token IS NOT DISTINCT FROM change.stored_refresh_token
          RETURNING account.id
        `
      })
      result.updated += updated.length
    }

    logger.info('Account token batch processed', { mode, dryRun, afterId, ...result })
    if (pauseMs > 0) await sleep(pauseMs)
  }

  return result
}
