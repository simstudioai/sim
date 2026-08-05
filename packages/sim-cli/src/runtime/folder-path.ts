import { SimApiError } from '../http/client.js'

/** Accepts root-relative folder input while preserving already-canonical paths. */
export function normalizeFolderPath(path: string): string {
  if (!path) throw new SimApiError('Folder path cannot be empty', 0)
  return path.startsWith('/') ? path : `/${path}`
}
