import { resolveDbUrl } from '@sim/db'
import { sealAccountTokens } from '@sim/db/script-migrations/0037_seal_account_tokens'
import { accountTokenSealingDisabledReason, readEncryptionKey } from '@sim/db/sealed-text'
import { createLogger } from '@sim/logger'
import { sealingKeyId } from '@sim/security/encryption'
import { task } from '@trigger.dev/sdk'
import postgres from 'postgres'

const logger = createLogger('SealAccountTokensTask')

const MAX_BATCH_SIZE = 1000
const MAX_PAUSE_MS = 10_000

export interface SealAccountTokensPayload {
  mode: 'seal' | 'unseal'
  dryRun: boolean
  /** The key id the fleet logs at startup (`Account token sealing`); must match this worker's. */
  expectedKeyId: string
  batchSize?: number
  pauseMs?: number
}

function assertIntegerInRange(name: string, value: number | undefined, min: number, max: number) {
  if (value === undefined) return
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`)
  }
}

/**
 * Runs the account-token sealing backfill (`0037_seal_account_tokens`) from a worker, which already
 * holds the database and the fleet's `ENCRYPTION_KEY`. Refuses before connecting when the payload
 * names a key id other than this worker's, so a pass can never seal rows under a key the fleet
 * cannot open, and refuses `seal` while this worker's writers still store plaintext (sealing opted
 * out with `ENCRYPT_ACCOUNT_TOKENS=false`).
 *
 * Opens its own single connection rather than reusing the `@sim/db` pool: the pass binds JS arrays
 * through the postgres.js tag, which needs the array type map the shared pool skips
 * (`fetch_types: false`). It resolves the same URL as the worker's `db` client and sets no startup
 * `search_path`, which PgBouncer rejects.
 */
export async function runSealAccountTokens(payload: SealAccountTokensPayload) {
  const { mode, dryRun, expectedKeyId, batchSize, pauseMs } = payload
  if (mode !== 'seal' && mode !== 'unseal') throw new Error(`Unknown mode ${String(mode)}`)
  if (typeof dryRun !== 'boolean') throw new Error('dryRun must be a boolean')
  if (typeof expectedKeyId !== 'string') throw new Error('expectedKeyId must be a string')
  assertIntegerInRange('batchSize', batchSize, 1, MAX_BATCH_SIZE)
  assertIntegerInRange('pauseMs', pauseMs, 0, MAX_PAUSE_MS)

  const keyId = sealingKeyId(readEncryptionKey())
  if (expectedKeyId !== keyId) {
    throw new Error(`ENCRYPTION_KEY has key id ${keyId}, not the expected ${expectedKeyId}`)
  }
  const disabledReason = accountTokenSealingDisabledReason()
  if (mode === 'seal' && disabledReason) {
    throw new Error(
      `Refusing to seal: ${disabledReason} on this worker, so writers still store plaintext`
    )
  }

  const role = process.env.SIM_DB_ROLE?.trim() || 'web'
  const url = resolveDbUrl('DATABASE_URL', role)
  if (!url) throw new Error('Missing DATABASE_URL environment variable')

  logger.info('Account token sealing started', { mode, dryRun, keyId, batchSize, pauseMs })
  const sql = postgres(url, {
    max: 1,
    prepare: false,
    connect_timeout: 30,
    idle_timeout: 20,
    onnotice: () => {},
    connection: { application_name: 'sim-account-token-sealing' },
  })
  try {
    const result = await sealAccountTokens(sql, {
      mode,
      expectedKeyId,
      dryRun,
      batchSize,
      pauseMs,
    })
    logger.info('Account token sealing finished', { mode, dryRun, ...result })
    return result
  } finally {
    await sql.end({ timeout: 5 })
  }
}

/** Manual-only: never scheduled or dispatched by app code; trigger it from the dashboard or API. */
export const sealAccountTokensTask = task({
  id: 'seal-account-tokens',
  machine: 'small-1x',
  maxDuration: 10_800,
  retry: { maxAttempts: 1 },
  queue: {
    name: 'seal-account-tokens',
    concurrencyLimit: 1,
  },
  run: (payload: SealAccountTokensPayload) => runSealAccountTokens(payload),
})
