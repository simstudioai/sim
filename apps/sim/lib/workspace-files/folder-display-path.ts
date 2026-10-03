import { buildFolderPath, parentFolderPath, parseFolderPath } from '@/lib/folders/paths'

/** Escapes one decoded folder name for the internal slash-delimited display path. */
export function encodeWorkspaceFileFolderDisplaySegment(name: string): string {
  if (name.length === 0) throw new Error('Workspace file folder names cannot be empty')
  return name.replaceAll('\\', '\\\\').replaceAll('/', '\\/')
}

/** Builds an internal display path where `\/` represents a slash inside a folder name. */
export function buildWorkspaceFileFolderDisplayPath(segments: readonly string[]): string {
  return segments.map(encodeWorkspaceFileFolderDisplaySegment).join('/')
}

/** Parses an internal display path without confusing an escaped slash for a path delimiter. */
export function parseWorkspaceFileFolderDisplayPath(path: string): string[] {
  if (path.length === 0) return []

  const segments: string[] = []
  let segment = ''

  for (let index = 0; index < path.length; index += 1) {
    const character = path[index]
    if (character === '/') {
      if (segment.length === 0) throw new Error('Workspace file folder path contains an empty name')
      segments.push(segment)
      segment = ''
      continue
    }
    if (character !== '\\') {
      segment += character
      continue
    }

    const escaped = path[index + 1]
    if (escaped !== '/' && escaped !== '\\') {
      throw new Error('Workspace file folder path contains an invalid escape')
    }
    segment += escaped
    index += 1
  }

  if (segment.length === 0) throw new Error('Workspace file folder path contains an empty name')
  segments.push(segment)
  return segments
}

/**
 * Decodes a folder path to its names, whichever of the two spellings it is in.
 *
 * Both circulate: a stored path is the display form, backslash-escaping a slash
 * inside a folder name, while anything that has been through
 * {@link toWorkspaceFileFolderPathView} is the canonical percent-encoded form.
 * They are told apart by the leading `/` the canonical form always carries, and
 * feeding one to the other's parser is the mistake this exists to absorb — a
 * canonical `/Reports` read as a display path is an empty first segment.
 */
export function folderPathSegments(path: string): string[] {
  return path.startsWith('/') ? parseFolderPath(path) : parseWorkspaceFileFolderDisplayPath(path)
}

/** A workspace file folder projected onto the canonical percent-encoded path form. */
export interface WorkspaceFileFolderPathView {
  name: string
  path: string
  parentPath: string
  createdAt: string
  updatedAt: string
}

/**
 * Projects a stored workspace file folder onto the canonical folder path form
 * shared with knowledge and tables.
 *
 * Stored paths are backslash-escaped display paths, so this cannot split on `/`:
 * a folder genuinely named `Q3/Q4` stores as `Q3\/Q4` and would otherwise read
 * as two levels. Decoding to segments and re-encoding through
 * {@link buildFolderPath} is the only conversion that survives such a name, and
 * the name check catches a stored path that has drifted from its own row.
 *
 * Shared by the v2 route and the file tool surface so the two cannot disagree
 * about what a folder's path is.
 */
export function toWorkspaceFileFolderPathView(folder: {
  name: string
  path: string
  createdAt: Date
  updatedAt: Date
}): WorkspaceFileFolderPathView {
  const segments = folderPathSegments(folder.path)
  if (segments.at(-1) !== folder.name) {
    throw new Error('Workspace file folder path does not match its folder name')
  }
  const path = buildFolderPath(segments)
  return {
    name: folder.name,
    path,
    parentPath: parentFolderPath(path),
    createdAt: folder.createdAt.toISOString(),
    updatedAt: folder.updatedAt.toISOString(),
  }
}
