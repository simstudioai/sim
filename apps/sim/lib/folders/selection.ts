/**
 * Reads every canonical folder path from current, legacy, or serialized picker
 * values, or from a typed comma-separated list.
 *
 * A comma is a safe separator because a canonical path never contains one:
 * `encodeFolderPathSegment` percent-encodes it as `%2C`. A list is what the
 * advanced half of a folder-scope pair holds, where several folders have to be
 * spelled in one text field.
 */
export function readFolderPaths(value: unknown): string[] {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return []
    if (trimmed.startsWith('[')) {
      try {
        return readFolderPaths(JSON.parse(trimmed))
      } catch {
        return [trimmed]
      }
    }
    return readFolderPaths(trimmed.split(','))
  }
  if (Array.isArray(value)) {
    return [
      ...new Set(
        value.flatMap((entry) => {
          if (typeof entry !== 'string') return []
          const path = entry.trim()
          return path ? [path] : []
        })
      ),
    ]
  }
  return []
}

/** Reads the first path for controls whose destination is necessarily singular. */
export function readFolderPath(value: unknown): string {
  return readFolderPaths(value)[0] ?? ''
}

/** Replaces one canonical folder path while preserving the picker's stored value shape. */
export function replaceFolderPath(value: unknown, sourcePath: string, targetPath: string): unknown {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed)
        if (!Array.isArray(parsed)) return value
        const replaced = replaceFolderPath(parsed, sourcePath, targetPath)
        return replaced === '' ? '' : JSON.stringify(replaced)
      } catch {
        return trimmed === sourcePath ? targetPath : value
      }
    }
    return trimmed === sourcePath ? targetPath : value
  }

  if (!Array.isArray(value)) return value
  let changed = false
  const next = value.flatMap((entry) => {
    if (typeof entry !== 'string' || entry.trim() !== sourcePath) return [entry]
    changed = true
    return targetPath ? [targetPath] : []
  })
  if (!changed) return value
  return next.length > 0 ? next : ''
}
