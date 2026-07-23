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
import micromatch from 'micromatch'
import safeRegex from 'safe-regex2'
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
const MAX_GREP_SCAN_BYTES = 100 * 1024 * 1024
const MAX_READ_LINES = 2_000
const MAX_GREP_LINE_LENGTH = 500
const REQUEST_ID_PATTERN = /^[^\x00-\x1f\x7f]{1,256}$/

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

export interface LocalFilesystemToolAuthorization {
  toolName: string
  args: Record<string, unknown>
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

function normalizeVfsDisplaySegment(segment: string): string {
  return segment
    .normalize('NFC')
    .trim()
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/\s+/g, ' ')
}

function mountVfsRoot(mount: GrantedMount): string {
  return `user-local/${encodeURIComponent(normalizeVfsDisplaySegment(mount.name))}--${mount.id}`
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

function compileGlob(pattern: string): (path: string) => boolean {
  if (!pattern || pattern.length > 512 || pattern.includes('\0') || pattern.includes('\\')) {
    throw new LocalFilesystemError('INVALID_REQUEST', 'Glob pattern is invalid.')
  }
  if (isAbsolute(pattern) || pattern.split('/').some((segment) => segment === '..')) {
    throw new LocalFilesystemError(
      'INVALID_REQUEST',
      'Glob patterns must stay within the selected directory.'
    )
  }

  return micromatch.matcher(pattern, {
    bash: false,
    dot: false,
    windows: false,
    nobrace: true,
    noext: true,
  })
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
  if (error instanceof DOMException && error.name === 'AbortError') {
    return new LocalFilesystemError('CANCELLED', 'The local filesystem operation was cancelled.')
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return new LocalFilesystemError('CANCELLED', 'The local filesystem operation was cancelled.')
  }
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

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new LocalFilesystemError('CANCELLED', 'The local filesystem operation was cancelled.')
  }
}

export class LocalFilesystemService {
  private readonly mounts = new Map<string, GrantedMount>()
  private readonly activeRequests = new Map<string, AbortController>()
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
    for (const controller of this.activeRequests.values()) {
      controller.abort()
    }
    this.activeRequests.clear()
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

      if (request.operation === 'cancel') {
        const requestId = this.requiredRequestId(request)
        const controller = this.activeRequests.get(requestId)
        controller?.abort()
        return { ok: true, data: { cancelled: controller !== undefined } }
      }

      const requestId =
        request.requestId === undefined ? undefined : this.requiredRequestId(request)
      if (requestId && this.activeRequests.has(requestId)) {
        throw new LocalFilesystemError(
          'INVALID_REQUEST',
          'A local filesystem operation with that request id is already running.'
        )
      }
      const controller = requestId ? new AbortController() : undefined
      if (requestId && controller) {
        this.activeRequests.set(requestId, controller)
      }

      let data: LocalFilesystemData
      try {
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
            data = await this.glob(
              this.requiredUri(request),
              this.requiredString(request, 'pattern'),
              request.pathPrefix,
              controller?.signal
            )
            break
          case 'read':
            data = await this.readText(
              this.requiredUri(request),
              request.startLine,
              request.lineCount,
              controller?.signal
            )
            break
          case 'grep':
            data = await this.grep(this.requiredUri(request), request, controller?.signal)
            break
          case 'stat':
            data = await this.statPath(this.requiredUri(request))
            break
          default:
            throw new LocalFilesystemError(
              'INVALID_REQUEST',
              'Local filesystem operation is not supported.'
            )
        }
      } finally {
        if (requestId) {
          this.activeRequests.delete(requestId)
        }
      }
      return { ok: true, data }
    } catch (error) {
      const safe = safeError(error)
      return { ok: false, code: safe.code, error: safe.message }
    }
  }

  /**
   * Bind a privileged read/search request to the canonical args persisted for
   * one authenticated pending client tool call. Renderer code chooses neither
   * a different operation nor a different granted path.
   */
  isAuthorizedClientToolRequest(
    request: unknown,
    authorization: LocalFilesystemToolAuthorization
  ): boolean {
    if (!isRecord(request) || typeof request.operation !== 'string') return false
    if (
      typeof request.requestId !== 'string' ||
      request.requestId.length === 0 ||
      !REQUEST_ID_PATTERN.test(request.requestId)
    ) {
      return false
    }
    const args = authorization.args

    const expectedUriForPath = (path: unknown): string | null => {
      if (typeof path !== 'string') return null
      for (const mount of this.mounts.values()) {
        const root = mountVfsRoot(mount)
        if (path === root) return mount.uri
        if (path.startsWith(`${root}/`)) {
          return `${mount.uri}${path.slice(root.length + 1)}`
        }
      }
      return null
    }

    switch (authorization.toolName) {
      case 'read': {
        if (request.operation !== 'read') return false
        const expectedUri = expectedUriForPath(args.path)
        const offset =
          typeof args.offset === 'number' && Number.isFinite(args.offset)
            ? Math.max(0, Math.trunc(args.offset))
            : 0
        const limit =
          typeof args.limit === 'number' && Number.isFinite(args.limit)
            ? Math.min(2000, Math.max(1, Math.trunc(args.limit)))
            : 2000
        return (
          expectedUri !== null &&
          request.uri === expectedUri &&
          request.startLine === offset + 1 &&
          request.lineCount === limit
        )
      }
      case 'grep': {
        if (request.operation !== 'grep' || request.pattern !== args.pattern) return false
        const rawPath = typeof args.path === 'string' ? args.path.replace(/\/+$/, '') : ''
        const uriAllowed =
          rawPath === 'user-local'
            ? [...this.mounts.values()].some((mount) => request.uri === mount.uri)
            : request.uri === expectedUriForPath(rawPath)
        const outputMode =
          args.output_mode === 'files_with_matches' || args.output_mode === 'count'
            ? args.output_mode
            : 'content'
        const maxResults =
          typeof args.maxResults === 'number' && Number.isFinite(args.maxResults)
            ? Math.min(MAX_GREP_RESULTS, Math.max(1, Math.trunc(args.maxResults)))
            : 50
        const context =
          typeof args.context === 'number' && Number.isFinite(args.context)
            ? Math.min(20, Math.max(0, Math.trunc(args.context)))
            : 0
        return (
          uriAllowed &&
          request.caseSensitive === (args.ignoreCase !== true) &&
          request.maxResults === maxResults &&
          request.outputMode === outputMode &&
          request.lineNumbers === (args.lineNumbers !== false) &&
          request.context === context
        )
      }
      case 'glob': {
        if (
          request.operation !== 'glob' ||
          typeof args.pattern !== 'string' ||
          request.pattern !== args.pattern
        ) {
          return false
        }
        for (const mount of this.mounts.values()) {
          if (request.uri !== mount.uri) continue
          return request.pathPrefix === mountVfsRoot(mount)
        }
        return false
      }
      case 'local_read':
        return request.operation === 'read' && request.uri === args.uri
      case 'local_grep':
        return (
          request.operation === 'grep' &&
          request.uri === args.uri &&
          request.query === args.query &&
          request.include === args.include &&
          request.caseSensitive === args.caseSensitive
        )
      case 'local_glob':
        return (
          request.operation === 'glob' &&
          request.uri === args.uri &&
          request.pattern === args.pattern &&
          request.pathPrefix === undefined
        )
      case 'local_list':
        return request.operation === 'list' && request.uri === args.uri
      case 'local_stat':
        return request.operation === 'stat' && request.uri === args.uri
      default:
        return false
    }
  }

  private requiredRequestId(request: Record<string, unknown>): string {
    const value = request.requestId
    if (typeof value !== 'string' || !REQUEST_ID_PATTERN.test(value)) {
      throw new LocalFilesystemError('INVALID_REQUEST', 'requestId is invalid.')
    }
    return value
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

  private async glob(
    uri: string,
    pattern: string,
    rawPathPrefix?: unknown,
    signal?: AbortSignal
  ): Promise<LocalFilesystemData> {
    throwIfAborted(signal)
    if (rawPathPrefix !== undefined && typeof rawPathPrefix !== 'string') {
      throw new LocalFilesystemError('INVALID_REQUEST', 'pathPrefix must be a string.')
    }
    const pathPrefix = typeof rawPathPrefix === 'string' ? rawPathPrefix.replace(/\/+$/, '') : ''
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
      throwIfAborted(signal)
      const current = stack.pop()
      if (!current) break
      const children = await readdir(current.path, { withFileTypes: true })
      children.sort((a, b) => b.name.localeCompare(a.name))

      for (const child of children) {
        throwIfAborted(signal)
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

        const candidatePath = pathPrefix ? `${pathPrefix}/${relativeFromBase}` : relativeFromBase
        if (matcher(candidatePath)) {
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
    rawLineCount: unknown,
    signal?: AbortSignal
  ): Promise<LocalFilesystemData> {
    throwIfAborted(signal)
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
        'The file is too large to read through user-local/.'
      )
    }

    const buffer = await readFile(resolvedPath.realPath, { signal })
    throwIfAborted(signal)
    if (isBinary(buffer)) {
      throw new LocalFilesystemError(
        'BINARY_FILE',
        'The file is binary and cannot be read through user-local/.'
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
    request: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<LocalFilesystemData> {
    throwIfAborted(signal)
    const rawPattern = request.pattern
    const rawQuery = request.query
    if (rawPattern !== undefined && typeof rawPattern !== 'string') {
      throw new LocalFilesystemError('INVALID_REQUEST', 'pattern must be a string.')
    }
    if (rawQuery !== undefined && typeof rawQuery !== 'string') {
      throw new LocalFilesystemError('INVALID_REQUEST', 'query must be a string.')
    }
    const expression = rawPattern ?? rawQuery
    if (typeof expression !== 'string' || expression.length < 1 || expression.length > 1000) {
      throw new LocalFilesystemError('INVALID_REQUEST', 'grep pattern is invalid.')
    }
    if (request.include !== undefined && typeof request.include !== 'string') {
      throw new LocalFilesystemError('INVALID_REQUEST', 'include must be a glob string.')
    }
    if (request.caseSensitive !== undefined && typeof request.caseSensitive !== 'boolean') {
      throw new LocalFilesystemError('INVALID_REQUEST', 'caseSensitive must be a boolean.')
    }
    const outputMode = request.outputMode ?? 'content'
    if (!['content', 'files_with_matches', 'count'].includes(String(outputMode))) {
      throw new LocalFilesystemError('INVALID_REQUEST', 'outputMode is invalid.')
    }
    if (request.lineNumbers !== undefined && typeof request.lineNumbers !== 'boolean') {
      throw new LocalFilesystemError('INVALID_REQUEST', 'lineNumbers must be a boolean.')
    }
    const rawContext = request.context ?? 0
    if (
      !Number.isInteger(rawContext) ||
      (rawContext as number) < 0 ||
      (rawContext as number) > 20
    ) {
      throw new LocalFilesystemError('INVALID_REQUEST', 'context must be an integer from 0 to 20.')
    }
    const contextLines = rawContext as number
    const maxResults = parsePositiveInteger(request.maxResults, 'maxResults', 50, MAX_GREP_RESULTS)

    const include = typeof request.include === 'string' ? request.include : '**/*'
    const matcher = compileGlob(include)
    const ignoreCase = request.caseSensitive !== true
    let regex: RegExp
    try {
      if (rawPattern !== undefined && !safeRegex(expression)) {
        throw new LocalFilesystemError(
          'INVALID_REQUEST',
          'grep pattern was rejected because it may cause catastrophic backtracking.'
        )
      }
      regex =
        rawPattern !== undefined
          ? new RegExp(expression, ignoreCase ? 'i' : '')
          : new RegExp(expression.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), ignoreCase ? 'i' : '')
    } catch (error) {
      if (error instanceof LocalFilesystemError) throw error
      if (outputMode === 'files_with_matches') {
        return { files: [], truncated: false }
      }
      if (outputMode === 'count') {
        return { counts: [], truncated: false }
      }
      return { matches: [], truncated: false }
    }
    const resolvedPath = await this.resolveUri(uri)
    const baseStat = await stat(resolvedPath.realPath)
    if (!baseStat.isDirectory() && !baseStat.isFile()) {
      throw new LocalFilesystemError('NOT_A_FILE', 'The localfs URI is not searchable.')
    }

    const matches: LocalFilesystemGrepMatch[] = []
    const files: string[] = []
    const counts: Array<{ uri: string; count: number }> = []
    let scanned = 0
    let scannedBytes = 0
    let truncated = false
    const stack = baseStat.isDirectory()
      ? [{ path: resolvedPath.realPath, relativeFromBase: '', depth: 0 }]
      : []

    const inspectFile = async (childPath: string, relativeFromBase: string): Promise<void> => {
      throwIfAborted(signal)
      if (baseStat.isDirectory() && !matcher(relativeFromBase)) return
      const fileStat = await stat(childPath)
      if (fileStat.size > MAX_TEXT_FILE_BYTES) return
      if (scannedBytes + fileStat.size > MAX_GREP_SCAN_BYTES) {
        truncated = true
        return
      }
      scannedBytes += fileStat.size
      const buffer = await readFile(childPath, { signal })
      if (isBinary(buffer)) return
      const content = new TextDecoder().decode(buffer)
      const mountRelativePath = baseStat.isFile()
        ? resolvedPath.relativePath
        : [resolvedPath.relativePath, relativeFromBase].filter(Boolean).join('/')
      const resultUri = localUri(resolvedPath.mount.id, mountRelativePath)

      if (outputMode === 'files_with_matches') {
        regex.lastIndex = 0
        if (regex.test(content)) files.push(resultUri)
        return
      }

      const lines = content.split(/\r?\n/)
      let count = 0
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        throwIfAborted(signal)
        regex.lastIndex = 0
        if (!regex.test(lines[lineIndex])) continue
        count++
        if (outputMode !== 'content') continue

        const contextStart = Math.max(0, lineIndex - contextLines)
        const contextEnd = Math.min(lines.length - 1, lineIndex + contextLines)
        for (let contextIndex = contextStart; contextIndex <= contextEnd; contextIndex++) {
          const line = lines[contextIndex]
          matches.push({
            uri: resultUri,
            line: request.lineNumbers === false ? 0 : contextIndex + 1,
            text:
              line.length > MAX_GREP_LINE_LENGTH ? `${line.slice(0, MAX_GREP_LINE_LENGTH)}…` : line,
          })
          if (matches.length >= maxResults) {
            truncated = true
            return
          }
        }
      }
      if (outputMode === 'count' && count > 0) {
        counts.push({ uri: resultUri, count })
      }
    }

    if (baseStat.isFile()) {
      await inspectFile(resolvedPath.realPath, basename(resolvedPath.realPath))
    }

    while (stack.length > 0 && !truncated) {
      throwIfAborted(signal)
      const current = stack.pop()
      if (!current) break
      const children = await readdir(current.path, { withFileTypes: true })
      for (const child of children) {
        throwIfAborted(signal)
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
        if (!child.isFile()) continue
        await inspectFile(childPath, relativeFromBase)
        if (truncated) break
        const resultCount =
          outputMode === 'files_with_matches'
            ? files.length
            : outputMode === 'count'
              ? counts.length
              : matches.length
        if (resultCount >= maxResults) {
          truncated = true
          break
        }
      }
    }

    if (outputMode === 'files_with_matches') {
      files.sort()
      return { files: files.slice(0, maxResults), truncated }
    }
    if (outputMode === 'count') {
      counts.sort((a, b) => a.uri.localeCompare(b.uri))
      return { counts: counts.slice(0, maxResults), truncated }
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
}
