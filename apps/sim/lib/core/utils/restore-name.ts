import { randomBytes } from 'crypto'
import { getPostgresErrorCode } from '@sim/utils/errors'

const HASH_ATTEMPTS = 8

const UNIQUE_VIOLATION_RETRIES = 8

/**
 * Retry harness for a restore-rename write: runs `attempt` — one full try at
 * choosing a restore name (via {@link generateRestoreName}) and persisting the
 * restore — retrying on Postgres unique violations (23505). A concurrent
 * create/rename can claim the chosen name between the availability check and
 * commit (MVCC), so each retry re-picks a fresh suffix.
 *
 * `attempt` reports the name it is about to claim through its
 * `reportAttemptedName` argument; after exhausting retries that name (or
 * `originalName` when none was reported) is passed to `makeConflictError` and
 * the result thrown. Non-23505 errors propagate unchanged.
 */
export async function restoreWithUniqueName<T>(
  originalName: string,
  makeConflictError: (attemptedName: string) => Error,
  attempt: (reportAttemptedName: (name: string) => void) => Promise<T>
): Promise<T> {
  let attemptedName = ''
  for (let i = 0; i < UNIQUE_VIOLATION_RETRIES; i++) {
    attemptedName = ''
    try {
      return await attempt((name) => {
        attemptedName = name
      })
    } catch (error: unknown) {
      if (getPostgresErrorCode(error) !== '23505') {
        throw error
      }
      if (i === UNIQUE_VIOLATION_RETRIES - 1) {
        throw makeConflictError(attemptedName || originalName)
      }
    }
  }
  throw makeConflictError(originalName)
}

/**
 * Generates a unique name for a restored entity by trying in order:
 * 1. The original name
 * 2. `name_restored` (inserted before file extension when `hasExtension` is true)
 * 3. `name_restored_{6-char hex}` — retries random suffixes until one is free
 */
export async function generateRestoreName(
  originalName: string,
  nameExists: (name: string) => Promise<boolean>,
  options?: { hasExtension?: boolean }
): Promise<string> {
  if (!(await nameExists(originalName))) {
    return originalName
  }

  const restoredName = addSuffix(originalName, '_restored', options?.hasExtension)
  if (!(await nameExists(restoredName))) {
    return restoredName
  }

  for (let i = 0; i < HASH_ATTEMPTS; i++) {
    const hash = randomBytes(3).toString('hex')
    const candidate = addSuffix(originalName, `_restored_${hash}`, options?.hasExtension)
    if (!(await nameExists(candidate))) {
      return candidate
    }
  }

  throw new Error(`Could not generate a unique restore name for "${originalName}"`)
}

function addSuffix(name: string, suffix: string, hasExtension?: boolean): string {
  if (hasExtension) {
    const dotIndex = name.lastIndexOf('.')
    if (dotIndex > 0) {
      return `${name.slice(0, dotIndex)}${suffix}${name.slice(dotIndex)}`
    }
  }
  return `${name}${suffix}`
}
