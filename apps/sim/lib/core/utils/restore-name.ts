import { randomBytes } from 'crypto'

const HASH_ATTEMPTS = 8

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
