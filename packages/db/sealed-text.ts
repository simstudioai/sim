import { createLogger } from '@sim/logger'
import { isSealed, seal, sealingKeyId, unseal } from '@sim/security/encryption'
import { toRecord } from '@sim/utils/object'
import { type SQL, sql } from 'drizzle-orm'
import { type AnyPgColumn, customType } from 'drizzle-orm/pg-core'

/** Operators read the key id and the sealing state from this report, so it logs at any configured level. */
const reportLogger = createLogger('AccountTokenSealing', { enabled: true, logLevel: 'INFO' })

const OPTED_OUT_REASON = 'ENCRYPT_ACCOUNT_TOKENS is false'
const UNUSABLE_KEY_REASON = 'ENCRYPTION_KEY is not a 64-character hex key'

let reportedUnusableKey = false
let reportedSealing = false

function readEncryptionKeyOrNull(): Buffer | null {
  const hex = process.env.ENCRYPTION_KEY
  return hex && /^[0-9a-f]{64}$/i.test(hex) ? Buffer.from(hex, 'hex') : null
}

/** The deployment's `ENCRYPTION_KEY`; throws when it is not a 64-character hex string. */
export function readEncryptionKey(): Buffer {
  const key = readEncryptionKeyOrNull()
  if (!key) throw new Error('ENCRYPTION_KEY must be set to a 64-character hex string (32 bytes)')
  return key
}

function isWriteSealingOptedOut(): boolean {
  const flag = process.env.ENCRYPT_ACCOUNT_TOKENS?.trim().toLowerCase()
  return flag === 'false' || flag === '0'
}

/**
 * Why this process writes account tokens unsealed, or null when it seals them. Sealing is on
 * whenever `ENCRYPTION_KEY` is a usable 64-character hex key, unless `ENCRYPT_ACCOUNT_TOKENS` opts
 * out with `false` or `0`.
 */
export function accountTokenSealingDisabledReason(): string | null {
  if (isWriteSealingOptedOut()) return OPTED_OUT_REASON
  return readEncryptionKeyOrNull() ? null : UNUSABLE_KEY_REASON
}

function reportUnusableKey(): void {
  if (reportedUnusableKey) return
  reportedUnusableKey = true
  reportLogger.warn(`Account token sealing: disabled (${UNUSABLE_KEY_REASON})`, { keyId: null })
}

/**
 * The key writes are sealed with, or null to write plaintext. Reads open sealed values regardless,
 * so every process can read both forms. A key that cannot seal writes plaintext, which every
 * process can still read, and reports the misconfiguration once instead of failing every token
 * write.
 */
function writeSealingKey(): Buffer | null {
  if (isWriteSealingOptedOut()) return null
  const key = readEncryptionKeyOrNull()
  if (!key) reportUnusableKey()
  return key
}

/** Logs once per process whether writes seal account tokens, why not, and the key id (never the key). */
export function reportAccountTokenSealing(): void {
  if (reportedSealing) return
  reportedSealing = true
  const reason = accountTokenSealingDisabledReason()
  if (reason === UNUSABLE_KEY_REASON) {
    reportUnusableKey()
    return
  }
  const key = readEncryptionKeyOrNull()
  reportLogger.info(`Account token sealing: ${reason ? `disabled (${reason})` : 'enabled'}`, {
    keyId: key ? sealingKeyId(key) : null,
  })
}

/**
 * The context a sealed-text column authenticates its values with (`account.access_token`), read
 * from the column's own definition rather than rebuilt from its table, so an `alias()` of the
 * table or a later rename never changes it. Drizzle keeps the field config on the column's
 * `config`, which aliased columns share.
 */
export function sealedTextContext(column: AnyPgColumn): string {
  const context = toRecord(toRecord(Reflect.get(column, 'config')).fieldConfig).context
  if (typeof context !== 'string')
    throw new Error(`Column ${column.name} is not a sealed-text column`)
  return context
}

/** Seals `plaintext` for `context` with `ENCRYPTION_KEY`; an already sealed value is returned as is. */
export function sealText(plaintext: string, context: string): string {
  return isSealed(plaintext) ? plaintext : seal(plaintext, readEncryptionKey(), context)
}

/** The plaintext of a stored value, which is either sealed or written before sealing was enabled. */
export function openText(stored: string, context: string): string {
  return isSealed(stored) ? unseal(stored, readEncryptionKey(), context) : stored
}

/**
 * A `text` column whose values are sealed at rest (see `seal` in `@sim/security/encryption`) and
 * bound to `<table>.<column>`, so a sealed value cannot be moved to another column. Drizzle reads
 * return plaintext. Never compare the column with `eq`: a bound parameter is sealed on
 * write-enabled processes and misses unsealed rows; use {@link sealedTextEquals}
 * (`check:sealed-columns` enforces both).
 */
export function sealedText(table: string, column: string) {
  const context = `${table}.${column}`
  return customType<{ data: string; driverData: string; config: { context: string } }>({
    dataType() {
      return 'text'
    },
    toDriver(value) {
      const key = isSealed(value) ? null : writeSealingKey()
      return key ? seal(value, key, context) : value
    },
    fromDriver(value) {
      return openText(value, context)
    },
  })(column, { context })
}

/**
 * Matches rows whose sealed-text `column` holds `plaintext`, stored sealed or not. Sealing is
 * deterministic, so equality stays a single atomic predicate. Without a usable key nothing can have
 * been sealed, so only the plaintext form is compared.
 */
export function sealedTextEquals(column: AnyPgColumn, plaintext: string): SQL {
  const key = readEncryptionKeyOrNull()
  return key && !isSealed(plaintext)
    ? sql`${column} IN (${plaintext}, ${seal(plaintext, key, sealedTextContext(column))})`
    : sql`${column} = ${plaintext}`
}
