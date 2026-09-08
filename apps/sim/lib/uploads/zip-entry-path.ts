import { ensureFileNameExtension } from '@/lib/uploads/utils/file-utils'
import { parseWorkspaceFileFolderDisplayPath } from '@/lib/workspace-files/folder-display-path'

/** Characters that are illegal in file names on common desktop platforms. */
const ILLEGAL_ENTRY_CHARS = /[<>:"/\\|?*\x00-\x1f]/g

/** A workspace file to place inside an archive. */
export interface ZipEntrySource {
  /** Display name of the file. Only its final path segment is used. */
  name: string
  /** Workspace-root-relative folder path holding the file, or null when it sits at the root. */
  folderPath?: string | null
  /** Stored content type; supplies the extension when the name carries none. */
  contentType?: string | null
}

export interface BuildZipEntryPathsOptions {
  /**
   * Drop the deepest folder path shared by every source, so an archive built from
   * one folder's contents is not buried under that folder's ancestor chain.
   */
  rebaseOnCommonFolder?: boolean
}

/** Split a folder path into non-empty segments. */
function toSegments(folderPath?: string | null): string[] {
  return folderPath ? parseWorkspaceFileFolderDisplayPath(folderPath) : []
}

/**
 * Reduce a name to a safe, single path segment: takes the final segment, drops
 * directory and traversal components, and falls back when nothing usable remains.
 * Keeps untrusted names from introducing nested or zip-slip-style paths.
 */
function toLeafName(name: string): string {
  const leaf = name.replace(/\\/g, '/').split('/').pop()?.trim()
  if (!leaf || leaf === '.' || leaf === '..') return 'file'
  return leaf
}

/**
 * Sanitize entry path segments before joining them: strips characters that are
 * illegal on common desktop platforms, neutralizes `.`/`..` traversal segments, and
 * drops empty segments. Returns `''` when no usable segment remains.
 */
function safeEntryPath(segments: string[]): string {
  return segments
    .map((segment) => {
      const cleaned = segment.trim().replace(ILLEGAL_ENTRY_CHARS, '_')
      return cleaned === '.' || cleaned === '..' ? '_' : cleaned
    })
    .filter(Boolean)
    .join('/')
}

/**
 * Append a numeric suffix to the file name of an entry path, leaving the directory
 * portion intact (`docs/report.pdf` -> `docs/report (1).pdf`).
 */
function withEntrySuffix(path: string, suffix: number): string {
  const slashIndex = path.lastIndexOf('/')
  const directory = path.slice(0, slashIndex + 1)
  const fileName = path.slice(slashIndex + 1)
  const dotIndex = fileName.lastIndexOf('.')

  return dotIndex > 0
    ? `${directory}${fileName.slice(0, dotIndex)} (${suffix})${fileName.slice(dotIndex)}`
    : `${directory}${fileName} (${suffix})`
}

/**
 * Longest folder path shared by every source, compared segment by segment so that
 * sibling folders like `Reports` and `Reports-2026` are never treated as nested.
 * Returns `''` when the sources have no common folder.
 */
function commonFolderSegments(sources: ZipEntrySource[]): string[] {
  let common: string[] | null = null

  for (const source of sources) {
    const segments = toSegments(source.folderPath)
    if (common === null) {
      common = segments
      continue
    }
    let matched = 0
    while (
      matched < common.length &&
      matched < segments.length &&
      common[matched] === segments[matched]
    ) {
      matched++
    }
    common = common.slice(0, matched)
    if (common.length === 0) break
  }

  return common ?? []
}

/**
 * Build unique, traversal-safe zip entry paths that mirror the workspace folder
 * layout of `sources`. Returns one path per source, in the same order.
 *
 * Collisions get a numeric suffix before the extension, matching the workspace
 * file naming convention (`report.pdf` -> `report (1).pdf`).
 */
export function buildZipEntryPaths(
  sources: ZipEntrySource[],
  options?: BuildZipEntryPathsOptions
): string[] {
  const rebaseLength = options?.rebaseOnCommonFolder ? commonFolderSegments(sources).length : 0
  const usedPaths = new Set<string>()

  return sources.map((source) => {
    const leafName = ensureFileNameExtension(toLeafName(source.name), source.contentType)
    const folderSegments = toSegments(source.folderPath).slice(rebaseLength)
    const basePath = safeEntryPath([...folderSegments, leafName]) || leafName

    let candidate = basePath
    let suffix = 1
    while (usedPaths.has(candidate)) {
      candidate = withEntrySuffix(basePath, suffix)
      suffix++
    }
    usedPaths.add(candidate)
    return candidate
  })
}
