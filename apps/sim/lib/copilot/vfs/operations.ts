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

export interface ReadResult {
  content: string
  totalLines: number
}

export interface DirEntry {
  name: string
  type: 'file' | 'dir'
}

/**
 * Regex search over VFS file contents.
 * Supports multiple output modes: content (default), files_with_matches, count.
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
      if (path && !filePath.startsWith(path)) continue
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
      if (path && !filePath.startsWith(path)) continue
      const lines = content.split('\n')
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
    if (path && !filePath.startsWith(path)) continue

    const lines = content.split('\n')
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
 * Convert a glob pattern to a RegExp.
 * Supports *, **, and ? wildcards.
 */
function globToRegExp(pattern: string): RegExp {
  let regexStr = '^'
  let i = 0
  while (i < pattern.length) {
    const ch = pattern[i]
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        // ** matches any number of path segments
        if (pattern[i + 2] === '/') {
          regexStr += '(?:.+/)?'
          i += 3
        } else {
          regexStr += '.*'
          i += 2
        }
      } else {
        // * matches anything except /
        regexStr += '[^/]*'
        i++
      }
    } else if (ch === '?') {
      regexStr += '[^/]'
      i++
    } else if ('.+^${}()|[]\\'.includes(ch)) {
      regexStr += '\\' + ch
      i++
    } else {
      regexStr += ch
      i++
    }
  }
  regexStr += '$'
  return new RegExp(regexStr)
}

/**
 * Glob pattern matching against VFS file paths and virtual directories.
 * Returns matching paths (both files and directory prefixes), just like a real filesystem.
 */
export function glob(files: Map<string, string>, pattern: string): string[] {
  const regex = globToRegExp(pattern)
  const result = new Set<string>()

  // Collect all virtual directory paths from file paths
  const directories = new Set<string>()
  for (const filePath of files.keys()) {
    const parts = filePath.split('/')
    for (let i = 1; i < parts.length; i++) {
      directories.add(parts.slice(0, i).join('/'))
    }
  }

  // Match file paths
  for (const filePath of files.keys()) {
    if (regex.test(filePath)) {
      result.add(filePath)
    }
  }

  // Match virtual directory paths
  for (const dir of directories) {
    if (regex.test(dir)) {
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
  const content = files.get(path)
  if (content === undefined) return null

  const lines = content.split('\n')
  const totalLines = lines.length

  if (offset !== undefined || limit !== undefined) {
    const start = offset ?? 0
    const end = limit !== undefined ? start + limit : lines.length
    return {
      content: lines.slice(start, end).join('\n'),
      totalLines,
    }
  }

  return { content, totalLines }
}

/**
 * List entries in a VFS directory path.
 * Returns files and subdirectories at the given path level.
 */
export function list(files: Map<string, string>, path: string): DirEntry[] {
  const normalizedPath = path.endsWith('/') ? path : path + '/'
  const seen = new Set<string>()
  const entries: DirEntry[] = []

  for (const filePath of files.keys()) {
    if (!filePath.startsWith(normalizedPath)) continue

    const remainder = filePath.slice(normalizedPath.length)
    if (!remainder) continue

    const slashIndex = remainder.indexOf('/')
    if (slashIndex === -1) {
      if (!seen.has(remainder)) {
        seen.add(remainder)
        entries.push({ name: remainder, type: 'file' })
      }
    } else {
      const dirName = remainder.slice(0, slashIndex)
      if (!seen.has(dirName)) {
        seen.add(dirName)
        entries.push({ name: dirName, type: 'dir' })
      }
    }
  }

  return entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}
