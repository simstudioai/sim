import { isSealed, seal, unseal } from '@sim/security/encryption'
import { type SQL, sql } from 'drizzle-orm'
import { type AnyPgColumn, customType } from 'drizzle-orm/pg-core'

function readEncryptionKeyOrNull(): Buffer | null {
  const hex = process.env.ENCRYPTION_KEY
  return hex && /^[0-9a-f]{64}$/i.test(hex) ? Buffer.from(hex, 'hex') : null
}

function readEncryptionKey(): Buffer {
  const key = readEncryptionKeyOrNull()
  if (!key) throw new Error('ENCRYPTION_KEY must be set to a 64-character hex string (32 bytes)')
  return key
}

/**
 * Whether writes seal values. Reads open sealed values regardless, so every process can read both
 * forms before any process writes the sealed one.
 */
function isWriteSealingEnabled(): boolean {
  const flag = process.env.ENCRYPT_ACCOUNT_TOKENS?.toLowerCase()
  return flag === 'true' || flag === '1'
}

/** Seals `plaintext` with the deployment's `ENCRYPTION_KEY`; an already sealed value is returned as is. */
export function sealText(plaintext: string): string {
  return isSealed(plaintext) ? plaintext : seal(plaintext, readEncryptionKey())
}

/** The plaintext of a stored value, which is either sealed or written before sealing was enabled. */
export function openText(stored: string): string {
  return isSealed(stored) ? unseal(stored, readEncryptionKey()) : stored
}

/**
 * A `text` column whose values are sealed at rest (see `seal` in `@sim/security/encryption`).
 * Drizzle reads return plaintext. Never compare the column with `eq`: a bound parameter is sealed
 * on write-enabled processes and misses unsealed rows; use {@link sealedTextEquals}.
 */
export const sealedText = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'text'
  },
  toDriver(value) {
    return isWriteSealingEnabled() ? sealText(value) : value
  },
  fromDriver(value) {
    return openText(value)
  },
})

/**
 * Matches rows whose sealed-text `column` holds `plaintext`, stored sealed or not. Sealing is
 * deterministic, so equality stays a single atomic predicate. Without a usable key nothing can have
 * been sealed, so only the plaintext form is compared.
 */
export function sealedTextEquals(column: AnyPgColumn, plaintext: string): SQL {
  const key = readEncryptionKeyOrNull()
  return key && !isSealed(plaintext)
    ? sql`${column} IN (${plaintext}, ${seal(plaintext, key)})`
    : sql`${column} = ${plaintext}`
}
