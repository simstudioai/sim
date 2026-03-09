import { v4 as uuidv4 } from 'uuid'

/**
 * Generate a UUID that works in all environments.
 *
 * `crypto.randomUUID()` is only available in secure contexts (HTTPS or localhost).
 * When the app is served over plain HTTP (e.g. self-hosted Docker on a LAN),
 * it throws "crypto.randomUUID is not a function" and the page white-screens.
 *
 * This helper tries the native API first and falls back to the `uuid` package.
 *
 * @see https://github.com/simstudioai/sim/issues/3393
 */
export function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return uuidv4()
}
