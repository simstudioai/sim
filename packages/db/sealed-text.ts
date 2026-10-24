import { createLogger } from '@sim/logger'
import { isSealed, seal, sealingKeyId, unseal } from '@sim/security/encryption'
import { toRecord } from '@sim/utils/object'
import { type SQL, sql } from 'drizzle-orm'
import { type AnyPgColumn, customType } from 'drizzle-orm/pg-core'

const logger = createLogger('SealedText')
/** Operators read the key id from this report, so it logs at any configured level. */
const reportLogger = createLogger('AccountTokenSealing', { enabled: true, logLevel: 'INFO' })

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

function isWriteSealingRequested(): boolean {
  const flag = process.env.ENCRYPT_ACCOUNT_TOKENS?.toLowerCase()
  return flag === 'true' || flag === '1'
}

/**
 * The key writes are sealed with, or null to write plaintext. Reads open sealed values regardless,
 * so every process can read both forms before any process writes the sealed one. Sealing requested
 * without a usable key writes plaintext, which every process can still read, and reports the
 * misconfiguration once instead of failing every token write.
 */
function writeSealingKey(): Buffer | null {
  if (!isWriteSealingRequested()) return null
  const key = readEncryptionKeyOrNull()
  if (!key && !reportedUnusableKey) {
    reportedUnusableKey = true
    logger.error(
      'ENCRYPT_ACCOUNT_TOKENS is set but ENCRYPTION_KEY is not a 64-character hex key; account tokens are written unsealed'
    )
  }
  return key
}

/** Logs once per process whether writes seal account tokens, and the key id (never the key). */
export function reportAccountTokenSealing(): void {
  if (reportedSealing) return
  reportedSealing = true
  const writeKey = writeSealingKey()
  const key = writeKey ?? readEncryptionKeyOrNull()
  reportLogger.info(`Account token sealing: ${writeKey ? 'enabled' : 'disabled'}`, {
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
