import { decryptSecret } from '@/lib/core/security/encryption'
import { isLargeArrayManifest } from '@/lib/execution/payloads/large-array-manifest-metadata'
import { isLargeValueRef } from '@/lib/execution/payloads/large-value-ref'

export const ANONYMOUS_SECRET_TRACE_REPLACEMENT = '[REDACTED_SECRET]'

const MAX_PROVENANCE_ENTRIES = 10_000
const MAX_SERIALIZED_PROVENANCE_BYTES = 8 * 1024 * 1024
const MAX_TRACE_CATALOG_ENTRIES = MAX_PROVENANCE_ENTRIES
const MAX_TRACE_CATALOG_BYTES = 8 * 1024 * 1024
const MAX_PROVENANCE_FILTER_NODES = 50_000
const MAX_PROVENANCE_FILTER_CHARACTERS = 16 * 1024 * 1024
const MAX_PROVENANCE_FILTER_COMPARISONS = 1_000_000
const ERROR_CONTENT_PROPERTY_NAMES = ['name', 'message', 'stack', 'cause', 'errors'] as const
const PROVENANCE_PROPERTY_NAMES = new Set(['version', 'complete', 'entries', 'scope'])
const PROVENANCE_ENTRY_PROPERTY_NAMES = new Set(['encryptedValue', 'name'])
const PROVENANCE_SCOPE_PROPERTY_NAMES = new Set(['userId', 'workspaceId'])

export interface ResolvedSecretTraceCatalogEntry {
  name: string
  plaintext: string
  encryptedValue: string
}

export interface ResolvedSecretTraceMatch {
  plaintext: string
  replacement: string
}

export interface ResolvedSecretTraceProvenanceEntryV1 {
  encryptedValue: string
  name?: string
}

export interface ResolvedSecretTraceScopeV1 {
  userId: string
  workspaceId?: string
}

export interface ResolvedSecretTraceProvenanceV1 {
  version: 1
  complete: boolean
  entries: ResolvedSecretTraceProvenanceEntryV1[]
  scope?: ResolvedSecretTraceScopeV1
}

interface ActiveSecretEntry extends ResolvedSecretTraceCatalogEntry {
  anonymous: boolean
}

export interface ImportResolvedSecretTraceProvenanceOptions {
  trusted: boolean
  anonymous?: boolean
}

export interface ExportResolvedSecretTraceProvenanceForValueOptions {
  anonymous?: boolean
}

export interface CreateResolvedSecretTraceRegistryOptions {
  personalEncrypted: Record<string, string>
  workspaceEncrypted: Record<string, string>
  personalDecrypted: Record<string, string>
  workspaceDecrypted: Record<string, string>
  decryptionFailures?: readonly string[]
  restoredProvenance?: unknown
  restoreTrusted?: boolean
  requireRestoredProvenance?: boolean
  scope?: ResolvedSecretTraceScopeV1
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function cloneProvenanceScope(scope: ResolvedSecretTraceScopeV1): ResolvedSecretTraceScopeV1 {
  return {
    userId: scope.userId,
    ...(scope.workspaceId ? { workspaceId: scope.workspaceId } : {}),
  }
}

function serializedJsonStringByteSize(value: string): number {
  let byteSize = 2
  for (let index = 0; index < value.length; index++) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit === 0x22 || codeUnit === 0x5c) {
      byteSize += 2
    } else if (
      codeUnit === 0x08 ||
      codeUnit === 0x09 ||
      codeUnit === 0x0a ||
      codeUnit === 0x0c ||
      codeUnit === 0x0d
    ) {
      byteSize += 2
    } else if (codeUnit <= 0x1f) {
      byteSize += 6
    } else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit = value.charCodeAt(index + 1)
      if (nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff) {
        byteSize += 4
        index++
      } else {
        byteSize += 6
      }
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      byteSize += 6
    } else if (codeUnit <= 0x7f) {
      byteSize++
    } else if (codeUnit <= 0x7ff) {
      byteSize += 2
    } else {
      byteSize += 3
    }
  }
  return byteSize
}

function serializedProvenanceEntryByteSize(entry: ResolvedSecretTraceProvenanceEntryV1): number {
  let byteSize =
    Buffer.byteLength('{"encryptedValue":', 'utf8') +
    serializedJsonStringByteSize(entry.encryptedValue)
  if (entry.name !== undefined) {
    byteSize += Buffer.byteLength(',"name":', 'utf8') + serializedJsonStringByteSize(entry.name)
  }
  return byteSize + 1
}

function serializedProvenanceEnvelopeByteSize(
  complete: boolean,
  scope: ResolvedSecretTraceScopeV1 | undefined
): number {
  let byteSize = Buffer.byteLength(
    `{"version":1,"complete":${complete ? 'true' : 'false'},"entries":[]`,
    'utf8'
  )
  if (scope) {
    byteSize +=
      Buffer.byteLength(',"scope":{"userId":', 'utf8') + serializedJsonStringByteSize(scope.userId)
    if (scope.workspaceId !== undefined) {
      byteSize +=
        Buffer.byteLength(',"workspaceId":', 'utf8') +
        serializedJsonStringByteSize(scope.workspaceId)
    }
    byteSize++
  }
  return byteSize + 1
}

function isSerializedProvenanceWithinLimit(
  complete: boolean,
  entries: readonly ResolvedSecretTraceProvenanceEntryV1[],
  scope: ResolvedSecretTraceScopeV1 | undefined
): boolean {
  let byteSize = serializedProvenanceEnvelopeByteSize(complete, scope)
  for (let index = 0; index < entries.length; index++) {
    byteSize += serializedProvenanceEntryByteSize(entries[index]) + (index === 0 ? 0 : 1)
    if (byteSize > MAX_SERIALIZED_PROVENANCE_BYTES) return false
  }
  return byteSize <= MAX_SERIALIZED_PROVENANCE_BYTES
}

function toProvenanceEntry(entry: ActiveSecretEntry): ResolvedSecretTraceProvenanceEntryV1 {
  return {
    encryptedValue: entry.encryptedValue,
    ...(!entry.anonymous && entry.name ? { name: entry.name } : {}),
  }
}

function hasOwn(record: Record<string, string>, name: string): boolean {
  return Object.hasOwn(record, name)
}

function isExactPlainDataRecord(
  value: unknown,
  allowedProperties: ReadonlySet<string>,
  requiredProperties: readonly string[]
): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false

  try {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return false

    const properties = Reflect.ownKeys(value)
    for (const property of properties) {
      if (typeof property !== 'string' || !allowedProperties.has(property)) return false
      const descriptor = Object.getOwnPropertyDescriptor(value, property)
      if (!descriptor?.enumerable || !('value' in descriptor)) return false
    }
    return requiredProperties.every((property) => Object.hasOwn(value, property))
  } catch {
    return false
  }
}

function isExactProvenanceEntriesArray(value: unknown): value is unknown[] {
  if (!Array.isArray(value)) return false

  try {
    if (Object.getPrototypeOf(value) !== Array.prototype) return false
    const properties = Reflect.ownKeys(value)
    if (properties.length !== value.length + 1 || !properties.includes('length')) return false

    for (let index = 0; index < value.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
      if (!descriptor?.enumerable || !('value' in descriptor)) return false
    }
    return true
  } catch {
    return false
  }
}

function catalogEntryByteSize(entry: ResolvedSecretTraceCatalogEntry): number {
  return (
    Buffer.byteLength(entry.name, 'utf8') +
    Buffer.byteLength(entry.plaintext, 'utf8') +
    Buffer.byteLength(entry.encryptedValue, 'utf8')
  )
}

function buildEffectiveCatalogEntry(
  options: CreateResolvedSecretTraceRegistryOptions,
  failedNames: ReadonlySet<string>,
  name: string,
  encryptedValue: string
): ResolvedSecretTraceCatalogEntry | undefined {
  const plaintext = hasOwn(options.workspaceDecrypted, name)
    ? options.workspaceDecrypted[name]
    : options.personalDecrypted[name]
  if (plaintext === undefined || (plaintext.length === 0 && failedNames.has(name))) {
    return undefined
  }
  return { name, plaintext, encryptedValue }
}

function* iterateEffectiveCatalogEntries(
  options: CreateResolvedSecretTraceRegistryOptions,
  failedNames: ReadonlySet<string>
): Generator<ResolvedSecretTraceCatalogEntry> {
  for (const name in options.personalEncrypted) {
    if (!hasOwn(options.personalEncrypted, name)) continue
    const encryptedValue = hasOwn(options.workspaceEncrypted, name)
      ? options.workspaceEncrypted[name]
      : options.personalEncrypted[name]
    const entry = buildEffectiveCatalogEntry(options, failedNames, name, encryptedValue)
    if (entry) yield entry
  }

  for (const name in options.workspaceEncrypted) {
    if (!hasOwn(options.workspaceEncrypted, name) || hasOwn(options.personalEncrypted, name)) {
      continue
    }
    const entry = buildEffectiveCatalogEntry(
      options,
      failedNames,
      name,
      options.workspaceEncrypted[name]
    )
    if (entry) yield entry
  }
}

function isProvenanceEntry(value: unknown): value is ResolvedSecretTraceProvenanceEntryV1 {
  if (!isExactPlainDataRecord(value, PROVENANCE_ENTRY_PROPERTY_NAMES, ['encryptedValue'])) {
    return false
  }
  const entry = value
  return (
    typeof entry.encryptedValue === 'string' &&
    entry.encryptedValue.length > 0 &&
    (entry.name === undefined || (typeof entry.name === 'string' && entry.name.length > 0))
  )
}

function isProvenanceScope(value: unknown): value is ResolvedSecretTraceScopeV1 {
  if (!isExactPlainDataRecord(value, PROVENANCE_SCOPE_PROPERTY_NAMES, ['userId'])) return false
  const scope = value
  return (
    typeof scope.userId === 'string' &&
    scope.userId.length > 0 &&
    (scope.workspaceId === undefined ||
      (typeof scope.workspaceId === 'string' && scope.workspaceId.length > 0))
  )
}

function scopesMatch(
  left: ResolvedSecretTraceScopeV1 | undefined,
  right: ResolvedSecretTraceScopeV1 | undefined
): boolean {
  return (
    (left === undefined && right === undefined) ||
    (left !== undefined &&
      right !== undefined &&
      left.userId === right.userId &&
      left.workspaceId === right.workspaceId)
  )
}

export function isResolvedSecretTraceProvenanceV1(
  value: unknown
): value is ResolvedSecretTraceProvenanceV1 {
  if (
    !isExactPlainDataRecord(value, PROVENANCE_PROPERTY_NAMES, ['version', 'complete', 'entries'])
  ) {
    return false
  }
  const provenance = value
  if (
    provenance.version !== 1 ||
    typeof provenance.complete !== 'boolean' ||
    !isExactProvenanceEntriesArray(provenance.entries) ||
    provenance.entries.length > MAX_PROVENANCE_ENTRIES ||
    !provenance.entries.every(isProvenanceEntry) ||
    (!provenance.complete && provenance.entries.length > 0) ||
    (provenance.scope !== undefined && !isProvenanceScope(provenance.scope))
  ) {
    return false
  }

  return isSerializedProvenanceWithinLimit(
    provenance.complete,
    provenance.entries,
    provenance.scope
  )
}

/**
 * Unions encrypted provenance reports emitted during one internal transport invocation.
 * It never decrypts values or projects trace content; the execution registry remains the
 * only owner of plaintext matches and replacement policy.
 */
export class ResolvedSecretTraceProvenanceAccumulator {
  private readonly scope?: ResolvedSecretTraceScopeV1
  private provenance: ResolvedSecretTraceProvenanceV1

  constructor(scope?: ResolvedSecretTraceScopeV1) {
    this.scope = scope ? cloneProvenanceScope(scope) : undefined
    this.provenance = this.emptyProvenance(true)
  }

  /** Adds one cold, warm-pool, or retry report without decrypting its entries. */
  record(provenance: unknown): boolean {
    if (!isResolvedSecretTraceProvenanceV1(provenance)) {
      this.provenance = this.emptyProvenance(false)
      return false
    }

    const sameScope = scopesMatch(provenance.scope, this.scope)
    const complete = this.provenance.complete && provenance.complete && sameScope
    if (!complete) {
      this.provenance = this.emptyProvenance(false)
      return true
    }

    const entries = new Map(
      this.provenance.entries.map((entry) => [
        `${entry.name ?? ''}\u0000${entry.encryptedValue}`,
        entry,
      ])
    )
    for (const entry of provenance.entries) {
      const scopedEntry: ResolvedSecretTraceProvenanceEntryV1 = {
        encryptedValue: entry.encryptedValue,
        ...(entry.name ? { name: entry.name } : {}),
      }
      entries.set(`${scopedEntry.name ?? ''}\u0000${scopedEntry.encryptedValue}`, scopedEntry)
    }

    const merged: ResolvedSecretTraceProvenanceV1 = {
      version: 1,
      complete: true,
      entries: [...entries.values()],
      ...(this.scope ? { scope: cloneProvenanceScope(this.scope) } : {}),
    }
    if (!isResolvedSecretTraceProvenanceV1(merged)) {
      this.provenance = this.emptyProvenance(false)
      return false
    }

    this.provenance = merged
    return true
  }

  /** Marks the invocation incomplete and discards entries that can no longer be trusted. */
  markIncomplete(): void {
    this.provenance = this.emptyProvenance(false)
  }

  exportProvenance(): ResolvedSecretTraceProvenanceV1 {
    return structuredClone(this.provenance)
  }

  private emptyProvenance(complete: boolean): ResolvedSecretTraceProvenanceV1 {
    return {
      version: 1,
      complete,
      entries: [],
      ...(this.scope ? { scope: cloneProvenanceScope(this.scope) } : {}),
    }
  }
}

/**
 * Tracks Secrets-tab values that were actually substituted through `{{NAME}}` during one run.
 * The current catalog is inert until a successful resolution activates an entry.
 */
export class ResolvedSecretTraceRegistry {
  private readonly catalog = new Map<string, ResolvedSecretTraceCatalogEntry>()
  private catalogBytes = 0
  private readonly activeEntries = new Map<string, ActiveSecretEntry>()
  private activeProvenanceEntryBytes = 0
  private complete = true
  private readonly scope?: ResolvedSecretTraceScopeV1
  private readonly completeProvenanceEnvelopeBytes: number

  constructor(
    catalogEntries: Iterable<ResolvedSecretTraceCatalogEntry> = [],
    scope?: ResolvedSecretTraceScopeV1
  ) {
    this.scope = scope ? cloneProvenanceScope(scope) : undefined
    this.completeProvenanceEnvelopeBytes = serializedProvenanceEnvelopeByteSize(true, this.scope)
    if (this.completeProvenanceEnvelopeBytes > MAX_SERIALIZED_PROVENANCE_BYTES) {
      this.markIncomplete()
    }
    let catalogEntriesSeen = 0
    for (const entry of catalogEntries) {
      catalogEntriesSeen++
      if (catalogEntriesSeen > MAX_TRACE_CATALOG_ENTRIES) {
        this.markIncomplete()
        break
      }
      if (!this.addCatalogEntry(entry)) break
    }
  }

  /** Activates a configured secret only when the resolved runtime value matches its catalog value. */
  recordResolved(name: string, resolvedValue: string): boolean {
    if (resolvedValue.length === 0) return false
    const catalogEntry = this.catalog.get(name)
    if (!catalogEntry || catalogEntry.plaintext !== resolvedValue) {
      this.markIncomplete()
      return false
    }

    this.addActiveEntry({ ...catalogEntry, anonymous: false })
    return true
  }

  /** Imports encrypted provenance only from a boundary that has already established trust. */
  async importProvenance(
    provenance: unknown,
    options: ImportResolvedSecretTraceProvenanceOptions
  ): Promise<boolean> {
    if (!options.trusted || !isResolvedSecretTraceProvenanceV1(provenance)) {
      this.markIncomplete()
      return false
    }

    if (!provenance.complete) {
      this.markIncomplete()
    }

    const sameScope = scopesMatch(provenance.scope, this.scope)
    let importedAll = true
    for (const entry of provenance.entries) {
      try {
        const { decrypted } = await decryptSecret(entry.encryptedValue)
        this.addActiveEntry({
          name: entry.name ?? '',
          plaintext: decrypted,
          encryptedValue: entry.encryptedValue,
          anonymous: options.anonymous === true || !sameScope || entry.name === undefined,
        })
      } catch {
        importedAll = false
        this.markIncomplete()
      }
    }

    return importedAll
  }

  /** Imports all same-scope provenance, or only anonymous literals crossing a trust boundary. */
  async importCrossingProvenance(
    provenance: unknown,
    crossingValue: unknown,
    options: { trusted: boolean }
  ): Promise<boolean> {
    if (!options.trusted || !isResolvedSecretTraceProvenanceV1(provenance)) {
      return this.importProvenance(provenance, { trusted: options.trusted })
    }

    if (scopesMatch(provenance.scope, this.scope)) {
      return this.importProvenance(provenance, { trusted: true })
    }

    const sourceRegistry = new ResolvedSecretTraceRegistry([], provenance.scope)
    const sourceImported = await sourceRegistry.importProvenance(provenance, { trusted: true })
    const crossingProvenance = sourceRegistry.exportProvenanceForValue(crossingValue, {
      anonymous: true,
    })
    const crossingImported = await this.importProvenance(crossingProvenance, { trusted: true })
    return sourceImported && crossingImported
  }

  /** Returns deterministic literal replacements for the terminal TraceSpan projection. */
  getActiveMatches(): readonly ResolvedSecretTraceMatch[] {
    const candidatesByPlaintext = new Map<string, ActiveSecretEntry[]>()
    for (const entry of this.activeEntries.values()) {
      if (entry.plaintext.length === 0) continue
      const candidates = candidatesByPlaintext.get(entry.plaintext) ?? []
      candidates.push(entry)
      candidatesByPlaintext.set(entry.plaintext, candidates)
    }

    const matches = [...candidatesByPlaintext.keys()].map((plaintext) => {
      const candidates = candidatesByPlaintext.get(plaintext) ?? []
      const anonymous = candidates.some((candidate) => candidate.anonymous)
      const firstNamed = candidates
        .filter((candidate) => !candidate.anonymous)
        .sort((left, right) => compareStrings(left.name, right.name))[0]
      const replacement = anonymous
        ? ANONYMOUS_SECRET_TRACE_REPLACEMENT
        : `{{${firstNamed?.name ?? ''}}}`

      return { plaintext, replacement }
    })

    return matches.sort(
      (left, right) =>
        right.plaintext.length - left.plaintext.length ||
        compareStrings(left.plaintext, right.plaintext) ||
        compareStrings(left.replacement, right.replacement)
    )
  }

  isComplete(): boolean {
    return this.complete
  }

  markIncomplete(): void {
    this.complete = false
  }

  /** Serializes only encrypted active values; plaintext never enters execution state. */
  exportProvenance(): ResolvedSecretTraceProvenanceV1 {
    const entries = this.complete
      ? this.buildProvenanceEntries([...this.activeEntries.values()])
      : []

    return {
      version: 1,
      complete: this.complete,
      entries,
      ...(this.scope ? { scope: cloneProvenanceScope(this.scope) } : {}),
    }
  }

  /**
   * Exports only active provenance whose exact plaintext occurs in a cross-boundary value.
   * Bounded traversal returns incomplete provenance instead of broadening to unrelated secrets.
   */
  exportProvenanceForValue(
    value: unknown,
    options: ExportResolvedSecretTraceProvenanceForValueOptions = {}
  ): ResolvedSecretTraceProvenanceV1 {
    if (!this.complete) return { version: 1, complete: false, entries: [] }

    const candidatesByPlaintext = new Map<string, ActiveSecretEntry>()
    const sortedActiveEntries = [...this.activeEntries.values()].sort(
      (left, right) =>
        compareStrings(left.name, right.name) ||
        compareStrings(left.encryptedValue, right.encryptedValue)
    )
    for (const entry of sortedActiveEntries) {
      if (entry.plaintext.length > 0 && !candidatesByPlaintext.has(entry.plaintext)) {
        candidatesByPlaintext.set(entry.plaintext, entry)
      }
    }

    const matchedEntries = new Map<string, ActiveSecretEntry>()
    const pendingValues: unknown[] = [value]
    const visited = new WeakSet<object>()
    let scannedNodes = 0
    let scannedCharacters = 0
    let comparisons = 0
    let enumeratedProperties = 0
    let scanComplete = true

    const scanString = (candidate: string): boolean => {
      scannedCharacters += candidate.length
      if (scannedCharacters > MAX_PROVENANCE_FILTER_CHARACTERS) return false

      for (const [plaintext, entry] of candidatesByPlaintext) {
        if (matchedEntries.has(plaintext)) continue
        comparisons++
        if (comparisons > MAX_PROVENANCE_FILTER_COMPARISONS) return false
        if (candidate.includes(plaintext)) {
          matchedEntries.set(plaintext, entry)
        }
      }
      return true
    }

    const scanProperty = (key: string, descriptor: PropertyDescriptor): boolean => {
      if (scannedNodes + pendingValues.length >= MAX_PROVENANCE_FILTER_NODES) return false
      scannedNodes++
      if (!scanString(key)) return false
      if (matchedEntries.size >= candidatesByPlaintext.size) return true

      if ('value' in descriptor) {
        if (scannedNodes + pendingValues.length >= MAX_PROVENANCE_FILTER_NODES) return false
        pendingValues.push(descriptor.value)
      } else if (descriptor.enumerable) {
        return false
      }
      return true
    }

    while (pendingValues.length > 0 && matchedEntries.size < candidatesByPlaintext.size) {
      const current = pendingValues.pop()
      scannedNodes++
      if (scannedNodes > MAX_PROVENANCE_FILTER_NODES) {
        scanComplete = false
        break
      }

      if (
        typeof current === 'string' ||
        typeof current === 'number' ||
        typeof current === 'boolean' ||
        current === null
      ) {
        if (!scanString(String(current))) scanComplete = false
        if (!scanComplete) break
        continue
      }

      if (typeof current !== 'object' || visited.has(current)) {
        continue
      }
      visited.add(current)

      if (isLargeValueRef(current) || isLargeArrayManifest(current)) {
        scanComplete = false
        break
      }

      try {
        for (const key of ERROR_CONTENT_PROPERTY_NAMES) {
          const descriptor = Object.getOwnPropertyDescriptor(current, key)
          if (descriptor && !descriptor.enumerable && !scanProperty(key, descriptor)) {
            scanComplete = false
            break
          }
          if (matchedEntries.size >= candidatesByPlaintext.size) break
        }
        if (!scanComplete || matchedEntries.size >= candidatesByPlaintext.size) break

        for (const key in current as Record<string, unknown>) {
          enumeratedProperties++
          if (enumeratedProperties > MAX_PROVENANCE_FILTER_NODES) {
            scanComplete = false
            break
          }

          const descriptor = Object.getOwnPropertyDescriptor(current, key)
          if (!descriptor) continue
          if (!scanProperty(key, descriptor)) {
            scanComplete = false
            break
          }
          if (matchedEntries.size >= candidatesByPlaintext.size) break
        }
        if (!scanComplete) break
      } catch {
        scanComplete = false
        break
      }
    }

    const complete = this.complete && scanComplete
    const entries = complete
      ? this.buildProvenanceEntries([...matchedEntries.values()], options.anonymous)
      : []
    return {
      version: 1,
      complete,
      entries,
      ...(this.scope ? { scope: cloneProvenanceScope(this.scope) } : {}),
    }
  }

  private addActiveEntry(entry: ActiveSecretEntry): void {
    const key = `${entry.anonymous ? 'anonymous' : entry.name}\u0000${entry.encryptedValue}`
    if (this.activeEntries.has(key)) {
      this.activeEntries.set(key, entry)
      return
    }

    const entryBytes = serializedProvenanceEntryByteSize(toProvenanceEntry(entry))
    const separatorBytes = this.activeEntries.size === 0 ? 0 : 1
    if (
      this.activeEntries.size >= MAX_PROVENANCE_ENTRIES ||
      this.completeProvenanceEnvelopeBytes +
        this.activeProvenanceEntryBytes +
        separatorBytes +
        entryBytes >
        MAX_SERIALIZED_PROVENANCE_BYTES
    ) {
      this.markIncomplete()
      return
    }
    this.activeEntries.set(key, entry)
    this.activeProvenanceEntryBytes += separatorBytes + entryBytes
  }

  private addCatalogEntry(entry: ResolvedSecretTraceCatalogEntry): boolean {
    const existing = this.catalog.get(entry.name)
    const nextCatalogBytes =
      this.catalogBytes -
      (existing ? catalogEntryByteSize(existing) : 0) +
      catalogEntryByteSize(entry)
    const nextCatalogSize = this.catalog.size + (existing ? 0 : 1)
    if (nextCatalogSize > MAX_TRACE_CATALOG_ENTRIES || nextCatalogBytes > MAX_TRACE_CATALOG_BYTES) {
      this.markIncomplete()
      return false
    }

    this.catalog.set(entry.name, { ...entry })
    this.catalogBytes = nextCatalogBytes
    return true
  }

  private buildProvenanceEntries(
    activeEntries: ActiveSecretEntry[],
    forceAnonymous = false
  ): ResolvedSecretTraceProvenanceEntryV1[] {
    return activeEntries
      .sort(
        (left, right) =>
          compareStrings(left.name, right.name) ||
          compareStrings(left.encryptedValue, right.encryptedValue)
      )
      .map((entry) => ({
        ...toProvenanceEntry({ ...entry, anonymous: forceAnonymous || entry.anonymous }),
      }))
  }
}

/** Builds the effective workspace-over-personal catalog and restores trusted active provenance. */
export async function createResolvedSecretTraceRegistry(
  options: CreateResolvedSecretTraceRegistryOptions
): Promise<ResolvedSecretTraceRegistry> {
  const failedNames = new Set(options.decryptionFailures ?? [])
  const registry = new ResolvedSecretTraceRegistry(
    iterateEffectiveCatalogEntries(options, failedNames),
    options.scope
  )

  if (options.restoredProvenance !== undefined) {
    await registry.importProvenance(options.restoredProvenance, {
      trusted: options.restoreTrusted === true,
    })
  } else if (options.requireRestoredProvenance) {
    registry.markIncomplete()
  }

  return registry
}

/** Creates a scoped fail-closed registry when trusted catalog provenance is unavailable. */
export function createIncompleteResolvedSecretTraceRegistry(
  scope?: ResolvedSecretTraceScopeV1
): ResolvedSecretTraceRegistry {
  const registry = new ResolvedSecretTraceRegistry([], scope)
  registry.markIncomplete()
  return registry
}
