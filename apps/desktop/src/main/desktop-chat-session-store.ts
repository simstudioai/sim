import { readFileSync, unlinkSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { isDesktopScopeId, isPendingDesktopScopeId } from '@sim/desktop-bridge'
import { isRecordLike } from '@sim/utils/object'
import { safeStorage } from 'electron'
import { writeJsonFileAtomicallySync } from '@/main/atomic-json-file'

const STORE_VERSION = 1
const SNAPSHOT_VERSION = 1
const MAX_DURABLE_ENTRIES = 100
const MAX_ORIGIN_LENGTH = 2_048
const MAX_URL_LENGTH = 8_192
const MAX_CWD_LENGTH = 4_096
const MAX_DOWNLOADS = 5
const MAX_DOWNLOAD_ID_LENGTH = 128
const MAX_DOWNLOAD_FILENAME_LENGTH = 200
const MAX_DOWNLOAD_PATH_LENGTH = 4_096
const DEFAULT_WRITE_DELAY_MS = 250

export interface BrowserSessionSnapshot {
  v: typeof SNAPSHOT_VERSION
  tabs: Array<{
    url: string
    pinned: boolean
  }>
  activeIndex: number
  downloads: Array<{
    id: string
    filename: string
    state: 'completed' | 'interrupted' | 'cancelled'
    receivedBytes: number
    totalBytes: number
    startedAt: string
    savePath: string
  }>
}

export interface TerminalSessionSnapshot {
  v: typeof SNAPSHOT_VERSION
  tabs: Array<{
    cwd: string
  }>
  activeIndex: number
}

export interface DesktopChatSessionEncryptionProvider {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}

export interface DesktopChatSessionStoreOptions {
  encryption?: DesktopChatSessionEncryptionProvider
  now?: () => number
  writeDelayMs?: number
}

interface SessionEntry {
  origin: string
  scope: string
  browser?: BrowserSessionSnapshot
  terminal?: TerminalSessionSnapshot
  lastAccessedAt: number
}

interface PersistedPayload {
  v: typeof STORE_VERSION
  entries: SessionEntry[]
}

interface EncryptedEnvelope {
  v: typeof STORE_VERSION
  ciphertext: string
}

function normalizeOrigin(origin: unknown): string | null {
  if (
    typeof origin !== 'string' ||
    origin.length === 0 ||
    origin.length > MAX_ORIGIN_LENGTH ||
    origin.includes('\0')
  ) {
    return null
  }

  try {
    const parsed = new URL(origin)
    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      parsed.username ||
      parsed.password
    ) {
      return null
    }
    return parsed.origin
  } catch {
    return null
  }
}

function normalizeScope(scope: unknown): string | null {
  return isDesktopScopeId(scope) ? scope : null
}

function isDurableScope(scope: string): boolean {
  return !isPendingDesktopScopeId(scope)
}

function normalizeBrowserUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_URL_LENGTH) return null
  if (value === 'about:blank') return value

  try {
    const parsed = new URL(value)
    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      parsed.username ||
      parsed.password
    ) {
      return null
    }
    return parsed.href
  } catch {
    return null
  }
}

function normalizeActiveIndex(value: unknown, tabCount: number): number {
  if (tabCount === 0) return 0
  if (typeof value !== 'number' || !Number.isInteger(value)) return 0
  return Math.max(0, Math.min(value, tabCount - 1))
}

function normalizeBrowserSnapshot(value: unknown): BrowserSessionSnapshot | null {
  if (
    !isRecordLike(value) ||
    value.v !== SNAPSHOT_VERSION ||
    !Array.isArray(value.tabs) ||
    !Array.isArray(value.downloads)
  ) {
    return null
  }

  const tabs: BrowserSessionSnapshot['tabs'] = []
  for (const candidate of value.tabs) {
    if (!isRecordLike(candidate) || typeof candidate.pinned !== 'boolean') continue
    const url = normalizeBrowserUrl(candidate.url)
    if (url === null) continue
    tabs.push({ url, pinned: candidate.pinned })
  }

  const downloads: BrowserSessionSnapshot['downloads'] = []
  for (const candidate of value.downloads) {
    if (!isRecordLike(candidate)) continue
    if (
      typeof candidate.id !== 'string' ||
      candidate.id.length === 0 ||
      candidate.id.length > MAX_DOWNLOAD_ID_LENGTH ||
      typeof candidate.filename !== 'string' ||
      candidate.filename.length === 0 ||
      candidate.filename.length > MAX_DOWNLOAD_FILENAME_LENGTH ||
      (candidate.state !== 'completed' &&
        candidate.state !== 'interrupted' &&
        candidate.state !== 'cancelled') ||
      typeof candidate.receivedBytes !== 'number' ||
      !Number.isSafeInteger(candidate.receivedBytes) ||
      candidate.receivedBytes < 0 ||
      typeof candidate.totalBytes !== 'number' ||
      !Number.isSafeInteger(candidate.totalBytes) ||
      candidate.totalBytes < 0 ||
      typeof candidate.startedAt !== 'string' ||
      !Number.isFinite(Date.parse(candidate.startedAt)) ||
      typeof candidate.savePath !== 'string' ||
      candidate.savePath.length === 0 ||
      candidate.savePath.length > MAX_DOWNLOAD_PATH_LENGTH ||
      candidate.savePath.includes('\0') ||
      !isAbsolute(candidate.savePath)
    ) {
      continue
    }
    downloads.push({
      id: candidate.id,
      filename: candidate.filename,
      state: candidate.state,
      receivedBytes: candidate.receivedBytes,
      totalBytes: candidate.totalBytes,
      startedAt: candidate.startedAt,
      savePath: candidate.savePath,
    })
    if (downloads.length >= MAX_DOWNLOADS) break
  }

  return {
    v: SNAPSHOT_VERSION,
    tabs,
    activeIndex: normalizeActiveIndex(value.activeIndex, tabs.length),
    downloads,
  }
}

function normalizeTerminalSnapshot(value: unknown): TerminalSessionSnapshot | null {
  if (!isRecordLike(value) || value.v !== SNAPSHOT_VERSION || !Array.isArray(value.tabs))
    return null

  const tabs: TerminalSessionSnapshot['tabs'] = []
  for (const candidate of value.tabs) {
    if (!isRecordLike(candidate) || typeof candidate.cwd !== 'string') continue
    if (
      candidate.cwd.trim().length === 0 ||
      candidate.cwd.length > MAX_CWD_LENGTH ||
      candidate.cwd.includes('\0')
    ) {
      continue
    }
    tabs.push({ cwd: candidate.cwd })
  }

  return {
    v: SNAPSHOT_VERSION,
    tabs,
    activeIndex: normalizeActiveIndex(value.activeIndex, tabs.length),
  }
}

function keyFor(origin: string, scope: string): string {
  return JSON.stringify([origin, scope])
}

/**
 * Persists the small descriptors needed to reconstruct each chat's browser
 * and terminal tabs. Live browser contents and shell processes remain owned by
 * their scoped registries; this store contains URLs, pin state, and working
 * directories, and a bounded recent-download list only.
 *
 * The complete payload is encrypted with Electron safeStorage before an
 * atomic owner-only write. When OS-backed encryption is unavailable, the same
 * synchronous API remains usable for the current process but nothing is
 * written in plaintext.
 */
export class DesktopChatSessionStore {
  private readonly encryption: DesktopChatSessionEncryptionProvider
  private readonly now: () => number
  private readonly writeDelayMs: number
  private readonly entries = new Map<string, SessionEntry>()
  private accessClock = 0
  private dirty = false
  private writeTimer: ReturnType<typeof setTimeout> | null = null
  private initialized = false
  private persistenceEnabled = false

  constructor(
    private readonly filePath: string,
    options: DesktopChatSessionStoreOptions = {}
  ) {
    this.encryption = options.encryption ?? safeStorage
    this.now = options.now ?? Date.now
    this.writeDelayMs = Math.max(0, options.writeDelayMs ?? DEFAULT_WRITE_DELAY_MS)
  }

  isAvailable(): boolean {
    try {
      return this.encryption.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  /**
   * Loads durable entries into memory. Call only after Electron's app-ready
   * event, when safeStorage is ready to use.
   */
  initialize(): boolean {
    if (this.initialized) return this.persistenceEnabled
    this.initialized = true
    if (!this.isAvailable()) return false

    try {
      const envelope = JSON.parse(readFileSync(this.filePath, 'utf8')) as unknown
      if (
        !isRecordLike(envelope) ||
        envelope.v !== STORE_VERSION ||
        typeof envelope.ciphertext !== 'string'
      ) {
        return false
      }

      const decrypted = this.encryption.decryptString(Buffer.from(envelope.ciphertext, 'base64'))
      const payload = JSON.parse(decrypted) as unknown
      if (
        !isRecordLike(payload) ||
        payload.v !== STORE_VERSION ||
        !Array.isArray(payload.entries)
      ) {
        return false
      }

      const loaded: SessionEntry[] = []
      for (const candidate of payload.entries) {
        const entry = this.normalizeEntry(candidate)
        if (entry && isDurableScope(entry.scope)) loaded.push(entry)
      }

      loaded.sort(
        (left, right) =>
          right.lastAccessedAt - left.lastAccessedAt ||
          keyFor(left.origin, left.scope).localeCompare(keyFor(right.origin, right.scope))
      )

      for (const [key, entry] of this.entries) {
        if (isDurableScope(entry.scope)) this.entries.delete(key)
      }
      for (const entry of loaded.slice(0, MAX_DURABLE_ENTRIES)) {
        this.entries.set(keyFor(entry.origin, entry.scope), entry)
        this.accessClock = Math.max(this.accessClock, entry.lastAccessedAt)
      }
      this.dirty = false
      this.persistenceEnabled = true
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.persistenceEnabled = true
        return true
      }
      // Preserve an unread file verbatim. This process remains memory-only
      // rather than replacing potentially recoverable encrypted state with a
      // partial fresh payload.
      this.persistenceEnabled = false
      return false
    }
  }

  getBrowser(origin: string, scope: string): BrowserSessionSnapshot | null {
    const entry = this.entryFor(origin, scope)
    if (!entry?.browser) return null
    this.touch(entry)
    this.changed(entry.scope)
    return structuredClone(entry.browser)
  }

  setBrowser(origin: string, scope: string, snapshot: BrowserSessionSnapshot): boolean {
    const normalized = normalizeBrowserSnapshot(snapshot)
    if (!normalized) return false
    const entry = this.ensureEntry(origin, scope)
    if (!entry) return false
    entry.browser = normalized
    this.touch(entry)
    this.changed(entry.scope)
    return true
  }

  getTerminal(origin: string, scope: string): TerminalSessionSnapshot | null {
    const entry = this.entryFor(origin, scope)
    if (!entry?.terminal) return null
    this.touch(entry)
    this.changed(entry.scope)
    return structuredClone(entry.terminal)
  }

  setTerminal(origin: string, scope: string, snapshot: TerminalSessionSnapshot): boolean {
    const normalized = normalizeTerminalSnapshot(snapshot)
    if (!normalized) return false
    const entry = this.ensureEntry(origin, scope)
    if (!entry) return false
    entry.terminal = normalized
    this.touch(entry)
    this.changed(entry.scope)
    return true
  }

  /**
   * Promotes only a provisional browser descriptor.
   *
   * Browser and terminal adapters migrate independently, and either may arrive
   * first. Moving one field into an existing destination entry lets the second
   * adapter add its field afterward without treating the first migration as a
   * whole-scope collision. An existing destination browser is never replaced.
   */
  migrateBrowser(origin: string, from: string, to: string): boolean {
    return this.migrateComponent(origin, from, to, 'browser')
  }

  /**
   * Promotes only a provisional terminal descriptor. See
   * {@link migrateBrowser} for the independent-adapter semantics.
   */
  migrateTerminal(origin: string, from: string, to: string): boolean {
    return this.migrateComponent(origin, from, to, 'terminal')
  }

  private migrateComponent(
    origin: string,
    from: string,
    to: string,
    component: 'browser' | 'terminal'
  ): boolean {
    const normalizedOrigin = normalizeOrigin(origin)
    const normalizedFrom = normalizeScope(from)
    const normalizedTo = normalizeScope(to)
    if (!normalizedOrigin || !normalizedFrom || !normalizedTo) return false
    if (isDurableScope(normalizedFrom) || !isDurableScope(normalizedTo)) return false

    const fromKey = keyFor(normalizedOrigin, normalizedFrom)
    const toKey = keyFor(normalizedOrigin, normalizedTo)
    const source = this.entries.get(fromKey)
    const destination = this.entries.get(toKey)

    // A dormant durable destination wins even when this component has no
    // provisional snapshot yet. Retagging live state over it would make the
    // next ordinary save silently replace the restored chat.
    if (component === 'browser') {
      const snapshot = source?.browser
      if (!snapshot) return destination?.browser === undefined
      if (destination?.browser) return false
      const target = destination ?? {
        origin: normalizedOrigin,
        scope: normalizedTo,
        lastAccessedAt: this.nextAccessTime(),
      }
      target.browser = snapshot
      this.touch(target)
      this.entries.set(toKey, target)
      if (source.terminal) {
        this.entries.set(fromKey, {
          origin: source.origin,
          scope: source.scope,
          terminal: source.terminal,
          lastAccessedAt: source.lastAccessedAt,
        })
      } else {
        this.entries.delete(fromKey)
      }
    } else {
      const snapshot = source?.terminal
      if (!snapshot) return destination?.terminal === undefined
      if (destination?.terminal) return false
      const target = destination ?? {
        origin: normalizedOrigin,
        scope: normalizedTo,
        lastAccessedAt: this.nextAccessTime(),
      }
      target.terminal = snapshot
      this.touch(target)
      this.entries.set(toKey, target)
      if (source.browser) {
        this.entries.set(fromKey, {
          origin: source.origin,
          scope: source.scope,
          browser: source.browser,
          lastAccessedAt: source.lastAccessedAt,
        })
      } else {
        this.entries.delete(fromKey)
      }
    }

    this.changed(normalizedTo)
    return true
  }

  deleteScope(origin: string, scope: string): boolean {
    const normalizedOrigin = normalizeOrigin(origin)
    const normalizedScope = normalizeScope(scope)
    if (!normalizedOrigin || !normalizedScope) return false

    const removed = this.entries.delete(keyFor(normalizedOrigin, normalizedScope))
    if (removed) this.changed(normalizedScope)
    return removed
  }

  /**
   * Synchronously publishes all durable state. Intended for Electron's
   * before-quit path, where an asynchronous write may never settle.
   */
  flush(): boolean {
    this.cancelScheduledWrite()
    if (!this.dirty) return true
    if (!this.persistenceEnabled || !this.isAvailable()) return false

    const entries = [...this.entries.values()]
      .filter((entry) => isDurableScope(entry.scope))
      .sort(
        (left, right) =>
          left.lastAccessedAt - right.lastAccessedAt ||
          keyFor(left.origin, left.scope).localeCompare(keyFor(right.origin, right.scope))
      )
      .slice(-MAX_DURABLE_ENTRIES)
      .map((entry) => ({
        ...entry,
        ...(entry.browser ? { browser: structuredClone(entry.browser) } : {}),
        ...(entry.terminal ? { terminal: structuredClone(entry.terminal) } : {}),
      }))

    try {
      const payload: PersistedPayload = { v: STORE_VERSION, entries }
      const envelope: EncryptedEnvelope = {
        v: STORE_VERSION,
        ciphertext: this.encryption.encryptString(JSON.stringify(payload)).toString('base64'),
      }
      writeJsonFileAtomicallySync(this.filePath, envelope)
      this.dirty = false
      return true
    } catch {
      return false
    }
  }

  /** Deletes both the encrypted file and every in-memory descriptor. */
  clear(): void {
    this.cancelScheduledWrite()
    this.entries.clear()
    this.accessClock = 0
    this.dirty = false

    try {
      unlinkSync(this.filePath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    this.initialized = true
    this.persistenceEnabled = this.isAvailable()
  }

  private entryFor(origin: string, scope: string): SessionEntry | null {
    const normalizedOrigin = normalizeOrigin(origin)
    const normalizedScope = normalizeScope(scope)
    if (!normalizedOrigin || !normalizedScope) return null
    return this.entries.get(keyFor(normalizedOrigin, normalizedScope)) ?? null
  }

  private ensureEntry(origin: string, scope: string): SessionEntry | null {
    const normalizedOrigin = normalizeOrigin(origin)
    const normalizedScope = normalizeScope(scope)
    if (!normalizedOrigin || !normalizedScope) return null

    const key = keyFor(normalizedOrigin, normalizedScope)
    const existing = this.entries.get(key)
    if (existing) return existing

    const entry: SessionEntry = {
      origin: normalizedOrigin,
      scope: normalizedScope,
      lastAccessedAt: this.nextAccessTime(),
    }
    this.entries.set(key, entry)
    if (isDurableScope(normalizedScope)) this.evictExcessDurableEntries()
    return entry
  }

  private normalizeEntry(value: unknown): SessionEntry | null {
    if (!isRecordLike(value)) return null
    const origin = normalizeOrigin(value.origin)
    const scope = normalizeScope(value.scope)
    if (!origin || !scope) return null

    const browser =
      value.browser === undefined ? undefined : normalizeBrowserSnapshot(value.browser)
    const terminal =
      value.terminal === undefined ? undefined : normalizeTerminalSnapshot(value.terminal)
    if (!browser && !terminal) return null

    return {
      origin,
      scope,
      ...(browser ? { browser } : {}),
      ...(terminal ? { terminal } : {}),
      lastAccessedAt:
        typeof value.lastAccessedAt === 'number' &&
        Number.isSafeInteger(value.lastAccessedAt) &&
        value.lastAccessedAt >= 0
          ? value.lastAccessedAt
          : 0,
    }
  }

  private touch(entry: SessionEntry): void {
    entry.lastAccessedAt = this.nextAccessTime()
  }

  private nextAccessTime(): number {
    this.accessClock = Math.max(this.accessClock + 1, this.now())
    return this.accessClock
  }

  private changed(scope: string): void {
    if (!isDurableScope(scope)) return
    this.dirty = true
    this.evictExcessDurableEntries()
    if (!this.persistenceEnabled || !this.isAvailable() || this.writeTimer) return
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null
      this.flush()
    }, this.writeDelayMs)
    this.writeTimer.unref()
  }

  private evictExcessDurableEntries(): void {
    const durableEntries = [...this.entries.entries()]
      .filter(([, entry]) => isDurableScope(entry.scope))
      .sort(
        ([leftKey, left], [rightKey, right]) =>
          left.lastAccessedAt - right.lastAccessedAt || leftKey.localeCompare(rightKey)
      )

    for (const [key] of durableEntries.slice(0, -MAX_DURABLE_ENTRIES)) {
      this.entries.delete(key)
    }
  }

  private cancelScheduledWrite(): void {
    if (!this.writeTimer) return
    clearTimeout(this.writeTimer)
    this.writeTimer = null
  }
}
