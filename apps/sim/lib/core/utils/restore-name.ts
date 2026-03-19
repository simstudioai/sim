import { randomBytes } from 'crypto'

/**
 * Generates a unique name for a restored entity by trying in order:
 * 1. The original name
 * 2. `name_restored` (inserted before file extension when `hasExtension` is true)
 * 3. `name_restored_{6-char hex}` (practically guaranteed unique)
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

  const hash = randomBytes(3).toString('hex')
  return addSuffix(originalName, `_restored_${hash}`, options?.hasExtension)
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
