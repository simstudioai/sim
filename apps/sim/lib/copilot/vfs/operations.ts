import micromatch from 'micromatch'

export interface GrepMatch {
  path: string
  line: number
  content: string
}

export type GrepOutputMode = 'content' | 'files_with_matches' | 'count'

export interface GrepOptions {
  maxResults?: number
  outputMode?: GrepOutputMode
  ignoreCase?: boolean
  lineNumbers?: boolean
  context?: number
}

export interface GrepCountEntry {
  path: string
  count: number
}

/**
 * Thrown when a single-file content grep (see `WorkspaceVFS.grepFile`) hits an
 * expected, user-facing condition: the path is not a single workspace file, the
 * file has no searchable text (image/binary), or it exceeds the inline read cap.
 * The grep handler surfaces the message verbatim instead of treating it as an
 * internal failure. Defined here (rather than in `workspace-vfs.ts`) so the
 * handler can reference it without pulling in the VFS module's heavy deps.
 */
export class WorkspaceFileGrepError extends Error {
  readonly code = 'WORKSPACE_FILE_GREP' as const
  constructor(message: string) {
    super(message)
    this.name = 'WorkspaceFileGrepError'
  }
}

/**
 * True when file content is one of `readFileRecord`'s non-text placeholders
 * (binary, unparseable, or over the inline read cap) — these carry no searchable
 * content, so grepping them should report the placeholder instead.
 */
function isNonGreppablePlaceholder(content: string, totalLines: number): boolean {
  if (totalLines !== 1) return false
  return /^\[(File too large|Image too large|Document too large|Could not parse|Binary file|Compiled artifact too large)/.test(
    content.trim()
  )
}

/**
 * Run a single-file content grep over an already-resolved file read result,
 * shared by workspace-file grep (`WorkspaceVFS.grepFile`) and chat-upload grep.
 * Throws {@link WorkspaceFileGrepError} when the file has no searchable text
 * (image/binary attachment) or is a size/parse placeholder; otherwise greps the
 * text with the standard {@link grep} engine over a one-entry map keyed by
 * `path`. `readHint` is the path to suggest in the "use read(...)" message.
 */
export function grepReadResult(
  path: string,
  result: { content: string; totalLines: number; attachment?: unknown },
  pattern: string,
  readHint: string,
  options?: GrepOptions
): GrepMatch[] | string[] | GrepCountEntry[] {
  if (result.attachment) {
    throw new WorkspaceFileGrepError(
      `Cannot grep "${path}" — it has no searchable text (image/binary). Use read("${readHint}") to view it.`
    )
  }
  if (isNonGreppablePlaceholder(result.content, result.totalLines)) {
    throw new WorkspaceFileGrepError(result.content)
  }
  return grep(new Map([[path, result.content]]), pattern, undefined, options)
}

export interface ReadResult {
  content: string
  totalLines: number
}

/**
 * Micromatch options tuned to match the prior in-house glob: `bash: false` so a single `*`
 * never crosses path slashes (required for `files` + star + `meta.json` style paths). `nobrace`
 * and `noext` disable brace and extglob expansion like the old builder. Uses `micromatch` for
 * well-tested `**` and edge cases instead of a custom `RegExp`.
 */
const VFS_GLOB_OPTIONS: micromatch.Options = {
  bash: false,
  dot: false,
  windows: false,
  nobrace: true,
  noext: true,
}

/**
 * True when `filePath` matches the glob `pattern` under {@link VFS_GLOB_OPTIONS}
 * (path-aware `*`/`?`, `**`, no brace/extglob). Exported so callers that build
 * their own path list (e.g. virtual archive entries) filter it exactly the way
 * {@link glob} filters the VFS map.
 */
export function matchesVfsGlob(filePath: string, pattern: string): boolean {
  return micromatch.isMatch(filePath, pattern, VFS_GLOB_OPTIONS)
}

/**
 * Splits VFS text into lines for line-oriented grep. Strips a trailing CR so Windows-style
 * CRLF payloads still match patterns anchored at line end (`$`).
 */
function splitLinesForGrep(content: string): string[] {
  return content.split('\n').map((line) => line.replace(/\r$/, ''))
}

/**
 * Returns true when `filePath` is `scope` or a descendant path (`scope/...`). If `scope` contains
 * `*` or `?`, filters with micromatch `isMatch` and {@link VFS_GLOB_OPTIONS}. Other characters
 * (including `[`, `{`, spaces) use directory-prefix logic so literal VFS path segments are not
 * parsed as glob syntax. Trailing slashes are stripped so `files/` and `files` both scope under
 * `files/...`.
 *
 * Exported so the lazy VFS can resolve exactly the lazy artifacts a scoped grep will consider,
 * keeping "what we materialize" identical to "what grep filters in".
 */
export function pathWithinGrepScope(filePath: string, scope: string): boolean {
  const scopeUsesStarOrQuestionGlob = /[*?]/.test(scope)
  if (scopeUsesStarOrQuestionGlob) {
    return micromatch.isMatch(filePath, scope, VFS_GLOB_OPTIONS)
  }
  const base = scope.replace(/\/+$/, '')
  if (base === '') {
    return true
  }
  return filePath === base || filePath.startsWith(`${base}/`)
}

/**
 * Regex search over VFS file contents using ECMAScript `RegExp` syntax.
 * `content` and `count` are line-oriented (split on newline, CR stripped per line).
 * `files_with_matches` tests the entire file string once, so multiline patterns can match there
 * but not in line modes.
 */
export function grep(
  files: Map<string, string>,
  pattern: string,
  path?: string,
  opts?: GrepOptions
): GrepMatch[] | string[] | GrepCountEntry[] {
  const maxResults = opts?.maxResults ?? 100
  const outputMode = opts?.outputMode ?? 'content'
  const ignoreCase = opts?.ignoreCase ?? false
  const showLineNumbers = opts?.lineNumbers ?? true
  const contextLines = opts?.context ?? 0

  const flags = ignoreCase ? 'gi' : 'g'
  let regex: RegExp
  try {
    regex = new RegExp(pattern, flags)
  } catch {
    return []
  }

  if (outputMode === 'files_with_matches') {
    const matchingFiles: string[] = []
    for (const [filePath, content] of files) {
      if (path && !pathWithinGrepScope(filePath, path)) continue
      regex.lastIndex = 0
      if (regex.test(content)) {
        matchingFiles.push(filePath)
        if (matchingFiles.length >= maxResults) break
      }
    }
    return matchingFiles
  }

  if (outputMode === 'count') {
    const counts: GrepCountEntry[] = []
    for (const [filePath, content] of files) {
      if (path && !pathWithinGrepScope(filePath, path)) continue
      const lines = splitLinesForGrep(content)
      let count = 0
      for (const line of lines) {
        regex.lastIndex = 0
        if (regex.test(line)) count++
      }
      if (count > 0) {
        counts.push({ path: filePath, count })
        if (counts.length >= maxResults) break
      }
    }
    return counts
  }

  // Default: 'content' mode
  const matches: GrepMatch[] = []
  for (const [filePath, content] of files) {
    if (path && !pathWithinGrepScope(filePath, path)) continue

    const lines = splitLinesForGrep(content)
    for (let i = 0; i < lines.length; i++) {
      regex.lastIndex = 0
      if (regex.test(lines[i])) {
        if (contextLines > 0) {
          const start = Math.max(0, i - contextLines)
          const end = Math.min(lines.length - 1, i + contextLines)
          for (let j = start; j <= end; j++) {
            matches.push({
              path: filePath,
              line: showLineNumbers ? j + 1 : 0,
              content: lines[j],
            })
          }
        } else {
          matches.push({
            path: filePath,
            line: showLineNumbers ? i + 1 : 0,
            content: lines[i],
          })
        }
        if (matches.length >= maxResults) return matches
      }
    }
  }

  return matches
}

/**
 * Glob pattern matching against VFS file paths and virtual directories using `micromatch`
 * with {@link VFS_GLOB_OPTIONS} (path-aware `*` and `?`, `**`, no brace or extglob expansion).
 * Returns matching file keys and virtual directory prefixes.
 */
export function glob(files: Map<string, string>, pattern: string): string[] {
  const result = new Set<string>()

  const directories = new Set<string>()
  for (const filePath of files.keys()) {
    if (filePath.endsWith('/.folder')) {
      directories.add(filePath.slice(0, -'/.folder'.length))
      continue
    }
    const parts = filePath.split('/')
    for (let i = 1; i < parts.length; i++) {
      directories.add(parts.slice(0, i).join('/'))
    }
  }

  for (const filePath of files.keys()) {
    if (filePath.endsWith('/.folder')) continue
    if (micromatch.isMatch(filePath, pattern, VFS_GLOB_OPTIONS)) {
      result.add(filePath)
    }
  }

  for (const dir of directories) {
    if (micromatch.isMatch(dir, pattern, VFS_GLOB_OPTIONS)) {
      result.add(dir)
    }
  }

  return Array.from(result).sort()
}

/**
 * Read a VFS file's content, optionally with offset and limit.
 * Returns null if the file does not exist.
 */
export function read(
  files: Map<string, string>,
  path: string,
  offset?: number,
  limit?: number
): ReadResult | null {
  let content = files.get(path)

  // Fallback: normalize Unicode and retry for encoding mismatches
  if (content === undefined) {
    const normalized = path.normalize('NFC')
    content = files.get(normalized)
    if (content === undefined) {
      for (const [key, value] of files) {
        if (key.normalize('NFC') === normalized) {
          content = value
          break
        }
      }
    }
  }

  if (content === undefined) return null

  const lines = content.split('\n')
  const totalLines = lines.length

  if (offset !== undefined || limit !== undefined) {
    const rawStart = Number.isFinite(offset) ? (offset as number) : 0
    const start = Math.max(0, Math.min(totalLines, rawStart))
    const rawEnd = limit !== undefined ? start + Math.max(0, limit) : totalLines
    const end = Math.max(start, Math.min(totalLines, rawEnd))
    return {
      content: lines.slice(start, end).join('\n'),
      totalLines,
    }
  }

  return { content, totalLines }
}

/**
 * Find VFS paths similar to a missing path.
 *
 * Handles two cases:
 * 1. Wrong filename: `components/blocks/gmail.json` → `gmail_v2.json`
 *    Matches by filename stem similarity within the same directory.
 * 2. Wrong directory: `workflows/Untitled/state.json` → `Untitled Workflow`
 *    Matches by parent directory name similarity with the same filename.
 */
export function suggestSimilar(files: Map<string, string>, missingPath: string, max = 5): string[] {
  const segments = missingPath.split('/')
  const filename = segments[segments.length - 1].toLowerCase()
  const fileStem = filename.replace(/\.[^.]+$/, '')
  const parentDir = segments.length >= 2 ? segments[segments.length - 2].toLowerCase() : ''
  const topDir = segments.length >= 1 ? `${segments[0]}/` : ''

  const scored: Array<{ path: string; score: number }> = []

  for (const vfsPath of files.keys()) {
    const vfsSegments = vfsPath.split('/')
    const vfsFilename = vfsSegments[vfsSegments.length - 1].toLowerCase()
    const vfsStem = vfsFilename.replace(/\.[^.]+$/, '')
    const vfsParentDir =
      vfsSegments.length >= 2 ? vfsSegments[vfsSegments.length - 2].toLowerCase() : ''
    const sameTopDir = topDir && vfsPath.startsWith(topDir)

    // Same filename, different directory — the directory name is wrong.
    // e.g. workflows/Untitled/state.json vs workflows/Untitled Workflow/state.json
    if (vfsFilename === filename && vfsParentDir !== parentDir && sameTopDir) {
      if (vfsParentDir.includes(parentDir) || parentDir.includes(vfsParentDir)) {
        scored.push({ path: vfsPath, score: 95 })
        continue
      }
    }

    // Same directory, different filename — the filename is wrong.
    const sameDir =
      segments.length === vfsSegments.length &&
      segments.slice(0, -1).join('/') === vfsSegments.slice(0, -1).join('/')

    if (sameDir) {
      if (vfsStem === fileStem) {
        scored.push({ path: vfsPath, score: 100 })
      } else if (vfsStem.includes(fileStem) || fileStem.includes(vfsStem)) {
        scored.push({ path: vfsPath, score: 80 })
      } else if (vfsFilename.includes(fileStem.replace(/[_-]/g, ''))) {
        scored.push({ path: vfsPath, score: 60 })
      }
    } else if (sameTopDir && vfsStem === fileStem) {
      // Same top-level directory and matching stem but different depth/parent
      scored.push({ path: vfsPath, score: 50 })
    }
  }

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, max).map((s) => s.path)
}
