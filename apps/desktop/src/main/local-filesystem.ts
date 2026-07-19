import { lstat, readdir, readFile, realpath, stat } from 'node:fs/promises'
import { basename, isAbsolute, resolve, sep } from 'node:path'
import type {
  LocalFilesystemData,
  LocalFilesystemEntry,
  LocalFilesystemEntryKind,
  LocalFilesystemGrepMatch,
  LocalFilesystemMount,
  LocalFilesystemResponse,
} from '@sim/desktop-bridge'
import { generateId } from '@sim/utils/id'
import { app, dialog } from 'electron'
import type {
  LocalFilesystemGrantStore,
  PersistedLocalFilesystemGrant,
} from '@/main/local-filesystem-grant-store'

const MAX_URI_LENGTH = 4096
const MAX_LIST_ENTRIES = 500
const MAX_SCAN_ENTRIES = 10_000
const MAX_SCAN_DEPTH = 50
const MAX_GLOB_RESULTS = 500
const MAX_GREP_RESULTS = 200
const MAX_TEXT_FILE_BYTES = 5 * 1024 * 1024
const MAX_STAGE_FILE_BYTES = 50 * 1024 * 1024
const MAX_READ_LINES = 2_000
const MAX_GREP_LINE_LENGTH = 500

type LocalFilesystemErrorCode = Extract<LocalFilesystemResponse, { ok: false }>['code']

class LocalFilesystemError extends Error {
  constructor(
    public readonly code: LocalFilesystemErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'LocalFilesystemError'
  }
}

interface GrantedMount extends LocalFilesystemMount {
  rootPath: string
  bookmark?: string
  stopAccessing?: () => void
}

interface ResolvedLocalPath {
  mount: GrantedMount
  relativePath: string
  lexicalPath: string
  realPath: string
}

interface LocalFilesystemServiceOptions {
  chooseDirectory?: () => Promise<string | SelectedDirectory | null>
  grantStore?: LocalFilesystemGrantStore
  startAccessingBookmark?: (bookmark: string) => (() => void) | undefined
}

interface SelectedDirectory {
  path: string
  bookmark?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isWithinRoot(rootPath: string, candidatePath: string): boolean {
  return candidatePath === rootPath || candidatePath.startsWith(`${rootPath}${sep}`)
}

function entryKind(entry: {
  isFile(): boolean
  isDirectory(): boolean
  isSymbolicLink(): boolean
}): LocalFilesystemEntryKind {
  if (entry.isFile()) return 'file'
  if (entry.isDirectory()) return 'directory'
  if (entry.isSymbolicLink()) return 'symlink'
  return 'other'
}

function encodeUriPath(relativePath: string): string {
  return relativePath
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

function localUri(mountId: string, relativePath = ''): string {
  const encodedPath = encodeUriPath(relativePath)
  return `localfs://${mountId}/${encodedPath}`
}

function parsePositiveInteger(value: unknown, name: string, fallback: number, max: number): number {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > max) {
    throw new LocalFilesystemError(
      'INVALID_REQUEST',
      `${name} must be an integer between 1 and ${max}.`
    )
  }
  return value as number
}

function compileGlob(pattern: string): RegExp {
  if (!pattern || pattern.length > 512 || pattern.includes('\0') || pattern.includes('\\')) {
    throw new LocalFilesystemError('INVALID_REQUEST', 'Glob pattern is invalid.')
  }
  if (isAbsolute(pattern) || pattern.split('/').some((segment) => segment === '..')) {
    throw new LocalFilesystemError(
      'INVALID_REQUEST',
      'Glob patterns must stay within the selected directory.'
    )
  }

  let source = '^'
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index]
    if (char === '*') {
      if (pattern[index + 1] === '*') {
        index++
        if (pattern[index + 1] === '/') {
          index++
          source += '(?:.*/)?'
        } else {
          source += '.*'
        }
      } else {
        source += '[^/]*'
      }
    } else if (char === '?') {
      source += '[^/]'
    } else {
      source += char.replace(/[|\\{}()[\]^$+*?.-]/g, '\\$&')
    }
  }
  return new RegExp(`${source}$`)
}

function isBinary(buffer: Uint8Array): boolean {
  const sampleLength = Math.min(buffer.length, 8192)
  for (let index = 0; index < sampleLength; index++) {
    if (buffer[index] === 0) return true
  }
  return false
}

function safeError(error: unknown): LocalFilesystemError {
  if (error instanceof LocalFilesystemError) return error
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code)
      : ''
  if (code === 'ENOENT') {
    return new LocalFilesystemError('NOT_FOUND', 'The local file or directory was not found.')
  }
  if (code === 'EACCES' || code === 'EPERM') {
    return new LocalFilesystemError('ACCESS_DENIED', 'The operating system denied access.')
  }
  return new LocalFilesystemError('IO_ERROR', 'The local filesystem operation failed.')
}

export class LocalFilesystemService {
  private readonly mounts = new Map<string, GrantedMount>()
  private readonly chooseDirectory: () => Promise<string | SelectedDirectory | null>
  private readonly grantStore?: LocalFilesystemGrantStore
  private readonly startAccessingBookmark: (bookmark: string) => (() => void) | undefined
  private initializePromise?: Promise<void>

  constructor(options: LocalFilesystemServiceOptions = {}) {
    this.grantStore = options.grantStore
    this.startAccessingBookmark =
      options.startAccessingBookmark ??
      ((bookmark) => {
        try {
          return app.startAccessingSecurityScopedResource(bookmark) as () => void
        } catch {
          return undefined
        }
      })
    this.chooseDirectory =
      options.chooseDirectory ??
      (async () => {
        const result = await dialog.showOpenDialog({
          title: 'Allow Sim to read a folder',
          buttonLabel: 'Allow',
          properties: ['openDirectory'],
          ...(process.platform === 'darwin' ? { securityScopedBookmarks: true } : {}),
        })
        if (result.canceled || !result.filePaths[0]) return null
        return {
          path: result.filePaths[0],
          ...(result.bookmarks?.[0] ? { bookmark: result.bookmarks[0] } : {}),
        }
      })
  }

  /**
   * Restore encrypted grants after Electron is ready. Invalid, moved, or
   * OS-revoked directories are skipped without exposing their host paths.
   */
  initialize(): Promise<void> {
    return (this.initializePromise ??= this.restoreRememberedMounts())
  }

  /** Release active OS handles while keeping encrypted grants for next launch. */
  close(): void {
    for (const mount of this.mounts.values()) {
      mount.stopAccessing?.()
    }
    this.mounts.clear()
  }

  /** Revoke every remembered grant, used on sign-out and origin changes. */
  async forgetAll(): Promise<void> {
    this.close()
    await this.grantStore?.clear()
  }

  async handle(request: unknown): Promise<LocalFilesystemResponse> {
    try {
      if (!isRecord(request) || typeof request.operation !== 'string') {
        throw new LocalFilesystemError('INVALID_REQUEST', 'Local filesystem request is invalid.')
      }

      let data: LocalFilesystemData
      switch (request.operation) {
        case 'mount_directory':
          data = await this.mountDirectory()
          break
        case 'list_mounts':
          data = this.listMounts()
          break
        case 'forget_mount':
          data = await this.forgetMount(this.requiredUri(request))
          break
        case 'list':
          data = await this.listDirectory(this.requiredUri(request))
          break
        case 'glob':
          data = await this.glob(this.requiredUri(request), this.requiredString(request, 'pattern'))
          break
        case 'read':
          data = await this.readText(
            this.requiredUri(request),
            request.startLine,
            request.lineCount
          )
          break
        case 'grep':
          data = await this.grep(
            this.requiredUri(request),
            this.requiredString(request, 'query'),
            request.include,
            request.caseSensitive
          )
          break
        case 'stat':
          data = await this.statPath(this.requiredUri(request))
          break
        case 'read_file_bytes':
          data = await this.readFileBytes(this.requiredUri(request))
          break
        default:
          throw new LocalFilesystemError(
            'INVALID_REQUEST',
            'Local filesystem operation is not supported.'
          )
      }
      return { ok: true, data }
    } catch (error) {
      const safe = safeError(error)
      return { ok: false, code: safe.code, error: safe.message }
    }
  }

  private requiredUri(request: Record<string, unknown>): string {
    return this.requiredString(request, 'uri', MAX_URI_LENGTH)
  }

  private requiredString(request: Record<string, unknown>, key: string, maxLength = 1000): string {
    const value = request[key]
    if (typeof value !== 'string' || value.length < 1 || value.length > maxLength) {
      throw new LocalFilesystemError('INVALID_REQUEST', `${key} is required.`)
    }
    return value
  }

  private async mountDirectory(): Promise<LocalFilesystemData> {
    const selection = await this.chooseDirectory()
    if (!selection) return { mount: null, cancelled: true }

    const selected = typeof selection === 'string' ? { path: selection } : selection
    const stopAccessing = selected.bookmark
      ? this.startAccessingBookmark(selected.bookmark)
      : undefined

    try {
      const rootPath = await realpath(selected.path)
      const rootStat = await stat(rootPath)
      if (!rootStat.isDirectory()) {
        throw new LocalFilesystemError('NOT_A_DIRECTORY', 'The selected item is not a directory.')
      }

      const existing = [...this.mounts.values()].find((mount) => mount.rootPath === rootPath)
      const id = existing?.id ?? generateId()
      const bookmark = selected.bookmark ?? existing?.bookmark
      const nextStopAccessing = selected.bookmark
        ? stopAccessing
        : (existing?.stopAccessing ??
          (bookmark ? this.startAccessingBookmark(bookmark) : undefined))
      if (selected.bookmark) {
        existing?.stopAccessing?.()
      }
      const mount: GrantedMount = {
        id,
        name: basename(rootPath) || 'Local files',
        uri: localUri(id),
        rootPath,
        remembered: existing?.remembered ?? false,
        ...(bookmark ? { bookmark } : {}),
        ...(nextStopAccessing ? { stopAccessing: nextStopAccessing } : {}),
      }
      this.mounts.set(id, mount)
      mount.remembered = await this.persistMounts()
      return { mount: this.publicMount(mount), cancelled: false }
    } catch (error) {
      stopAccessing?.()
      throw error
    }
  }

  private listMounts(): LocalFilesystemData {
    return { mounts: [...this.mounts.values()].map((mount) => this.publicMount(mount)) }
  }

  private publicMount(mount: GrantedMount): LocalFilesystemMount {
    return {
      id: mount.id,
      name: mount.name,
      uri: mount.uri,
      remembered: mount.remembered,
    }
  }

  private async restoreRememberedMounts(): Promise<void> {
    if (!this.grantStore) return
    const grants = await this.grantStore.load()
    let skipped = false

    for (const grant of grants) {
      if (!/^[a-zA-Z0-9-]{1,128}$/.test(grant.id) || this.mounts.has(grant.id)) {
        skipped = true
        continue
      }
      const stopAccessing = grant.bookmark ? this.startAccessingBookmark(grant.bookmark) : undefined
      try {
        const rootPath = await realpath(grant.rootPath)
        const rootStat = await stat(rootPath)
        if (!rootStat.isDirectory()) {
          stopAccessing?.()
          skipped = true
          continue
        }
        this.mounts.set(grant.id, {
          id: grant.id,
          name: basename(rootPath) || grant.name || 'Local files',
          uri: localUri(grant.id),
          rootPath,
          remembered: true,
          ...(grant.bookmark ? { bookmark: grant.bookmark } : {}),
          ...(stopAccessing ? { stopAccessing } : {}),
        })
      } catch {
        stopAccessing?.()
        skipped = true
      }
    }

    if (skipped) {
      await this.persistMounts()
    }
  }

  private persistedMounts(): PersistedLocalFilesystemGrant[] {
    return [...this.mounts.values()].map((mount) => ({
      id: mount.id,
      name: mount.name,
      rootPath: mount.rootPath,
      ...(mount.bookmark ? { bookmark: mount.bookmark } : {}),
    }))
  }

  private async persistMounts(): Promise<boolean> {
    if (!this.grantStore) return false
    try {
      if (this.mounts.size === 0) {
        await this.grantStore.clear()
        return true
      }
      const remembered = await this.grantStore.save(this.persistedMounts())
      if (remembered) {
        for (const mount of this.mounts.values()) {
          mount.remembered = true
        }
      }
      return remembered
    } catch {
      return false
    }
  }

  private async forgetMount(uri: string): Promise<LocalFilesystemData> {
    const { mount } = this.parseUri(uri)
    mount.stopAccessing?.()
    this.mounts.delete(mount.id)

    const persisted = await this.persistMounts()
    if (!persisted && this.grantStore) {
      // Fail closed: if an updated encrypted grant set cannot be written,
      // remove the store so a revoked mount cannot return after restart.
      await this.grantStore.clear()
      for (const remaining of this.mounts.values()) {
        remaining.remembered = false
      }
    }
    return { forgotten: true }
  }

  private parseUri(uri: string): { mount: GrantedMount; relativePath: string } {
    if (!uri.startsWith('localfs://')) {
      throw new LocalFilesystemError('INVALID_URI', 'The localfs URI is invalid.')
    }
    const rawPathSegments = uri.slice('localfs://'.length).split('/').slice(1)
    for (const rawSegment of rawPathSegments) {
      let decodedSegment: string
      try {
        decodedSegment = decodeURIComponent(rawSegment)
      } catch {
        throw new LocalFilesystemError('INVALID_URI', 'The localfs URI is invalid.')
      }
      if (decodedSegment === '.' || decodedSegment === '..') {
        throw new LocalFilesystemError(
          'ACCESS_DENIED',
          'The requested path is outside the selected folder.'
        )
      }
    }

    let parsed: URL
    try {
      parsed = new URL(uri)
    } catch {
      throw new LocalFilesystemError('INVALID_URI', 'The localfs URI is invalid.')
    }
    if (
      parsed.protocol !== 'localfs:' ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password ||
      parsed.port ||
      parsed.search ||
      parsed.hash
    ) {
      throw new LocalFilesystemError('INVALID_URI', 'The localfs URI is invalid.')
    }

    const mount = this.mounts.get(parsed.hostname)
    if (!mount) {
      throw new LocalFilesystemError(
        'MOUNT_NOT_FOUND',
        'That local folder is no longer available. Select it again.'
      )
    }

    const encodedSegments = parsed.pathname.split('/').filter(Boolean)
    const segments = encodedSegments.map((segment) => {
      let decoded: string
      try {
        decoded = decodeURIComponent(segment)
      } catch {
        throw new LocalFilesystemError('INVALID_URI', 'The localfs URI is invalid.')
      }
      if (
        !decoded ||
        decoded === '.' ||
        decoded === '..' ||
        decoded.includes('/') ||
        decoded.includes('\\') ||
        decoded.includes('\0')
      ) {
        throw new LocalFilesystemError('INVALID_URI', 'The localfs URI is invalid.')
      }
      return decoded
    })
    return { mount, relativePath: segments.join('/') }
  }

  private async resolveUri(uri: string): Promise<ResolvedLocalPath> {
    const { mount, relativePath } = this.parseUri(uri)
    const lexicalPath = resolve(mount.rootPath, ...relativePath.split('/').filter(Boolean))
    if (!isWithinRoot(mount.rootPath, lexicalPath)) {
      throw new LocalFilesystemError(
        'ACCESS_DENIED',
        'The requested path is outside the selected folder.'
      )
    }
    const realPath = await realpath(lexicalPath)
    if (!isWithinRoot(mount.rootPath, realPath)) {
      throw new LocalFilesystemError(
        'ACCESS_DENIED',
        'The requested path is outside the selected folder.'
      )
    }
    return { mount, relativePath, lexicalPath, realPath }
  }

  private async listDirectory(uri: string): Promise<LocalFilesystemData> {
    const resolvedPath = await this.resolveUri(uri)
    const directoryStat = await stat(resolvedPath.realPath)
    if (!directoryStat.isDirectory()) {
      throw new LocalFilesystemError('NOT_A_DIRECTORY', 'The localfs URI is not a directory.')
    }

    const directoryEntries = await readdir(resolvedPath.realPath, { withFileTypes: true })
    directoryEntries.sort((a, b) => a.name.localeCompare(b.name))
    const truncated = directoryEntries.length > MAX_LIST_ENTRIES
    const entries = await Promise.all(
      directoryEntries.slice(0, MAX_LIST_ENTRIES).map(async (directoryEntry) => {
        const childRelativePath = [resolvedPath.relativePath, directoryEntry.name]
          .filter(Boolean)
          .join('/')
        const metadata = await lstat(resolve(resolvedPath.realPath, directoryEntry.name))
        const item: LocalFilesystemEntry = {
          name: directoryEntry.name,
          uri: localUri(resolvedPath.mount.id, childRelativePath),
          kind: entryKind(directoryEntry),
          size: metadata.size,
          modifiedAt: metadata.mtime.toISOString(),
        }
        return item
      })
    )
    return { entries, truncated }
  }

  private async glob(uri: string, pattern: string): Promise<LocalFilesystemData> {
    const matcher = compileGlob(pattern)
    const resolvedPath = await this.resolveUri(uri)
    const baseStat = await stat(resolvedPath.realPath)
    if (!baseStat.isDirectory()) {
      throw new LocalFilesystemError('NOT_A_DIRECTORY', 'The localfs URI is not a directory.')
    }

    const entries: LocalFilesystemEntry[] = []
    let scanned = 0
    let truncated = false
    const stack = [{ path: resolvedPath.realPath, relativeFromBase: '', depth: 0 }]

    while (stack.length > 0 && !truncated) {
      const current = stack.pop()
      if (!current) break
      const children = await readdir(current.path, { withFileTypes: true })
      children.sort((a, b) => b.name.localeCompare(a.name))

      for (const child of children) {
        scanned++
        if (scanned > MAX_SCAN_ENTRIES) {
          truncated = true
          break
        }
        const relativeFromBase = [current.relativeFromBase, child.name].filter(Boolean).join('/')
        const childPath = resolve(current.path, child.name)
        const mountRelativePath = [resolvedPath.relativePath, relativeFromBase]
          .filter(Boolean)
          .join('/')

        if (matcher.test(relativeFromBase)) {
          const metadata = await lstat(childPath)
          entries.push({
            name: child.name,
            uri: localUri(resolvedPath.mount.id, mountRelativePath),
            kind: entryKind(child),
            size: metadata.size,
            modifiedAt: metadata.mtime.toISOString(),
          })
          if (entries.length >= MAX_GLOB_RESULTS) {
            truncated = true
            break
          }
        }

        if (child.isDirectory() && !child.isSymbolicLink() && current.depth < MAX_SCAN_DEPTH) {
          stack.push({
            path: childPath,
            relativeFromBase,
            depth: current.depth + 1,
          })
        }
      }
    }

    entries.sort((a, b) => a.uri.localeCompare(b.uri))
    return { entries, truncated }
  }

  private async readText(
    uri: string,
    rawStartLine: unknown,
    rawLineCount: unknown
  ): Promise<LocalFilesystemData> {
    const startLine = parsePositiveInteger(rawStartLine, 'startLine', 1, Number.MAX_SAFE_INTEGER)
    const lineCount = parsePositiveInteger(rawLineCount, 'lineCount', 500, MAX_READ_LINES)
    const resolvedPath = await this.resolveUri(uri)
    const fileStat = await stat(resolvedPath.realPath)
    if (!fileStat.isFile()) {
      throw new LocalFilesystemError('NOT_A_FILE', 'The localfs URI is not a file.')
    }
    if (fileStat.size > MAX_TEXT_FILE_BYTES) {
      throw new LocalFilesystemError(
        'FILE_TOO_LARGE',
        'The file is too large for local_read. Use local_stage_file instead.'
      )
    }

    const buffer = await readFile(resolvedPath.realPath)
    if (isBinary(buffer)) {
      throw new LocalFilesystemError(
        'BINARY_FILE',
        'The file is binary. Use local_stage_file to upload it.'
      )
    }
    const content = new TextDecoder().decode(buffer)
    const lines = content.length === 0 ? [] : content.split(/\r?\n/)
    const selectedLines = lines.slice(startLine - 1, startLine - 1 + lineCount)
    const endLine = selectedLines.length === 0 ? 0 : startLine + selectedLines.length - 1
    return {
      uri,
      content: selectedLines.join('\n'),
      startLine,
      endLine,
      totalLines: lines.length,
    }
  }

  private async grep(
    uri: string,
    query: string,
    rawInclude: unknown,
    rawCaseSensitive: unknown
  ): Promise<LocalFilesystemData> {
    if (query.length > 1000) {
      throw new LocalFilesystemError('INVALID_REQUEST', 'grep query is too long.')
    }
    if (rawInclude !== undefined && typeof rawInclude !== 'string') {
      throw new LocalFilesystemError('INVALID_REQUEST', 'include must be a glob string.')
    }
    if (rawCaseSensitive !== undefined && typeof rawCaseSensitive !== 'boolean') {
      throw new LocalFilesystemError('INVALID_REQUEST', 'caseSensitive must be a boolean.')
    }

    const include = rawInclude ?? '**/*'
    const matcher = compileGlob(include)
    const caseSensitive = rawCaseSensitive === true
    const needle = caseSensitive ? query : query.toLocaleLowerCase()
    const resolvedPath = await this.resolveUri(uri)
    const baseStat = await stat(resolvedPath.realPath)
    if (!baseStat.isDirectory()) {
      throw new LocalFilesystemError('NOT_A_DIRECTORY', 'The localfs URI is not a directory.')
    }

    const matches: LocalFilesystemGrepMatch[] = []
    let scanned = 0
    let truncated = false
    const stack = [{ path: resolvedPath.realPath, relativeFromBase: '', depth: 0 }]

    while (stack.length > 0 && !truncated) {
      const current = stack.pop()
      if (!current) break
      const children = await readdir(current.path, { withFileTypes: true })
      for (const child of children) {
        scanned++
        if (scanned > MAX_SCAN_ENTRIES) {
          truncated = true
          break
        }
        const relativeFromBase = [current.relativeFromBase, child.name].filter(Boolean).join('/')
        const childPath = resolve(current.path, child.name)
        if (child.isDirectory() && !child.isSymbolicLink() && current.depth < MAX_SCAN_DEPTH) {
          stack.push({
            path: childPath,
            relativeFromBase,
            depth: current.depth + 1,
          })
          continue
        }
        if (!child.isFile() || !matcher.test(relativeFromBase)) continue

        const fileStat = await stat(childPath)
        if (fileStat.size > MAX_TEXT_FILE_BYTES) continue
        const buffer = await readFile(childPath)
        if (isBinary(buffer)) continue
        const lines = new TextDecoder().decode(buffer).split(/\r?\n/)
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
          const line = lines[lineIndex]
          const haystack = caseSensitive ? line : line.toLocaleLowerCase()
          const column = haystack.indexOf(needle)
          if (column < 0) continue
          const mountRelativePath = [resolvedPath.relativePath, relativeFromBase]
            .filter(Boolean)
            .join('/')
          matches.push({
            uri: localUri(resolvedPath.mount.id, mountRelativePath),
            line: lineIndex + 1,
            column: column + 1,
            text:
              line.length > MAX_GREP_LINE_LENGTH ? `${line.slice(0, MAX_GREP_LINE_LENGTH)}…` : line,
          })
          if (matches.length >= MAX_GREP_RESULTS) {
            truncated = true
            break
          }
        }
        if (truncated) break
      }
    }

    matches.sort((a, b) => a.uri.localeCompare(b.uri) || a.line - b.line)
    return { matches, truncated }
  }

  private async statPath(uri: string): Promise<LocalFilesystemData> {
    const resolvedPath = await this.resolveUri(uri)
    const metadata = await lstat(resolvedPath.lexicalPath)
    return {
      name: basename(resolvedPath.lexicalPath) || resolvedPath.mount.name,
      uri,
      kind: entryKind(metadata),
      size: metadata.size,
      modifiedAt: metadata.mtime.toISOString(),
    }
  }

  private async readFileBytes(uri: string): Promise<LocalFilesystemData> {
    const resolvedPath = await this.resolveUri(uri)
    const fileStat = await stat(resolvedPath.realPath)
    if (!fileStat.isFile()) {
      throw new LocalFilesystemError('NOT_A_FILE', 'The localfs URI is not a file.')
    }
    if (fileStat.size > MAX_STAGE_FILE_BYTES) {
      throw new LocalFilesystemError(
        'FILE_TOO_LARGE',
        'The local file is larger than the 50 MB staging limit.'
      )
    }
    const buffer = await readFile(resolvedPath.realPath)
    return {
      uri,
      name: basename(resolvedPath.lexicalPath),
      size: buffer.byteLength,
      bytes: new Uint8Array(buffer),
    }
  }
}
