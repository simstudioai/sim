import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  buildFolderPath,
  MAX_FOLDER_NAME_LENGTH,
  MAX_FOLDER_PATH_SEGMENTS,
} from '@/lib/folders/paths'

export const MAX_UPLOAD_DIRECTORIES = 1_000
const MAX_UPLOAD_ROOT_DIRECTORIES = 100
export const MAX_UPLOAD_SELECTION_ENTRIES = 5_000

/** Validates native relative paths without silently changing their names or hierarchy. */
export function validateUploadPath(path: readonly string[]): void {
  if (path.length === 0 || path.length > MAX_FOLDER_PATH_SEGMENTS) {
    throw new OrchestrationError('validation', 'The selected path is too deep')
  }
  for (const name of path) {
    if (name.length > MAX_FOLDER_NAME_LENGTH) {
      throw new OrchestrationError(
        'validation',
        `Folder names cannot exceed ${MAX_FOLDER_NAME_LENGTH} characters`
      )
    }
    if (!name || name !== name.trim() || name === '.' || name === '..' || /[/\\]/.test(name)) {
      throw new OrchestrationError(
        'validation',
        `Cannot upload the name "${name}" without changing its path`
      )
    }
  }
  buildFolderPath(path)
}

/** Bounds and orders a complete directory manifest before any folders are created. */
export function validateUploadDirectories(paths: readonly string[][]): string[][] {
  if (paths.length === 0 || paths.length > MAX_UPLOAD_DIRECTORIES) {
    throw new OrchestrationError(
      'validation',
      `Select between 1 and ${MAX_UPLOAD_DIRECTORIES} folders at a time`
    )
  }
  const keys = new Set<string>()
  let roots = 0
  for (const path of paths) {
    validateUploadPath(path)
    const key = JSON.stringify(path)
    if (keys.has(key))
      throw new OrchestrationError('validation', 'The folder selection contains duplicate paths')
    keys.add(key)
    if (path.length === 1) roots += 1
  }
  if (roots > MAX_UPLOAD_ROOT_DIRECTORIES) {
    throw new OrchestrationError(
      'validation',
      `Select at most ${MAX_UPLOAD_ROOT_DIRECTORIES} top-level folders at a time`
    )
  }
  for (const path of paths) {
    if (path.length > 1 && !keys.has(JSON.stringify(path.slice(0, -1)))) {
      throw new OrchestrationError('validation', 'The folder selection is missing a parent folder')
    }
  }
  return [...paths].sort((left, right) => left.length - right.length)
}
