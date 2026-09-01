import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { decryptSecret } from '@/lib/core/security/encryption'
import { isLargeArrayManifest } from '@/lib/execution/payloads/large-array-manifest-metadata'
import { isLargeValueRef } from '@/lib/execution/payloads/large-value-ref'
import { MAX_INLINE_MATERIALIZATION_BYTES } from '@/lib/execution/payloads/limits'
import {
  PROVENANCE_MAX_ENTRIES,
  PROVENANCE_MAX_SERIALIZED_BYTES,
} from '@/lib/execution/provenance-limits'
import { isNonIdentifyingSecretLiteral } from '@/executor/utils/resolved-secret-match-policy'
import {
  createResolvedSecretMatcher,
  OPAQUE_RESOLVED_SECRET_REPLACEMENT,
  type ResolvedSecretMatcher,
  scanResolvedSecretString,
} from '@/executor/utils/resolved-secret-matcher'
import { getResolvedSecretMatcherCapacityFailure } from '@/executor/utils/resolved-secret-matcher-capacity'

const logger = createLogger('ResolvedSecretTraceRegistry')

/**
 * Why a registry stopped being able to vouch for what it projects.
 *
 * Incompleteness is one-way and fails every later model projection in the run, surfacing to the
 * user as a single opaque sentence. Recording which guard tripped is the only way to tell a
 * genuine containment from a matcher that merely could not decide — the reasons are static
 * literals and the logged path is block/field names, never a resolved value.
 */
export type ResolvedSecretIncompletenessReason =
  | 'untrusted-provenance'
  | 'source-provenance-incomplete'
  | 'entry-decrypt-failed'
  | 'unverified-resolved-entry'
  | 'projection-mismatch'
  | 'unresolved-placeholder'
  | 'provenance-capacity-exceeded'
  | 'restored-checkpoint-unavailable'
  | 'constructed-incomplete'
  | 'inherited-incomplete-source'
  | 'inherited-incomplete-input-path'
  | 'tool-call-scope-mismatch'
  | 'value-provenance-untrusted'
  /**
   * A crossing carried no provenance at all, which is what a run that failed before producing any
   * looks like. Distinct from `untrusted`: nothing was rejected, there was nothing to reject.
   */
  | 'value-provenance-absent'
  | 'value-provenance-import-failed'
  | 'value-provenance-filter-incomplete'
  | 'durable-provenance-unknown'
  | 'durable-provenance-malformed'
  | 'tool-input-not-enumerable'
  | 'tool-params-transform-failed'
  | 'mcp-tool-execution-timeout'
  | 'structural-input-projection-incomplete'
  | 'structural-input-root-unprojected'
  | 'mothership-provenance-invalid'
  | 'mothership-response-unreadable'
  | 'mothership-provenance-missing'
  | 'client-tool-seal-absent'
  | 'client-tool-seal-failed'
  | 'client-tool-completion-missing'
  | 'client-tool-completion-deferred'
  | 'client-tool-completion-unidentified'
  | 'client-tool-execution-untrusted'
  | 'client-tool-content-unavailable'
  | 'knowledge-result-provenance-unavailable'
  | 'knowledge-row-missing'
  | 'knowledge-row-content-mismatch'
  | 'table-result-provenance-unavailable'
  | 'mounted-file-provenance-unavailable'
  | 'workspace-file-provenance-unknown'
  | 'file-source-unidentified'
  | 'table-snapshot-unsafe-for-mount'
  | 'restored-provenance-untrusted'
  | 'backfill-checkpoint-absent'
  | 'backfill-checkpoint-unusable'
  | 'log-creation-skipped'
  /**
   * No production caller uses this, and none should: a refusal reporting it names no guard, which
   * is the state that made a production latch untraceable. It survives for tests that need a
   * latched registry and have no guard to name, where a borrowed real reason would read as a claim
   * about which one tripped. A new caller wanting it wants a new literal instead.
   */
  | 'unspecified'

/**
 * Reasons that mean something went wrong, rather than that provenance was never on offer.
 *
 * These log at error: each is a guard tripping on a path that should have succeeded, none is
 * reachable on a healthy run, and error is the only level surviving every default the logger falls
 * back to — production, test, and a self-hosted chart that sets no `LOG_LEVEL`.
 *
 * Everything absent from this set logs at warn, which is the deliberate default. Incompleteness is
 * also the *designed* state wherever there is no catalog to vouch with, and those paths are hot — a
 * webhook execution builds an incomplete registry on every run before replacing it. Defaulting to
 * warn keeps a by-design state, an upstream bundle that already declared itself incomplete, a fork
 * inheriting a parent that reported moments earlier, or an unaudited caller taking the default
 * reason from flooding the error stream. A reason added later without thought stays quiet.
 */
/**
 * Reasons meaning provenance was never on offer AND no secret material transited the latching
 * context. This is a deliberately separate, narrower set than the warn side of the report-level
 * split below: that split assigns report ownership, and a warn-level reason can still involve
 * plaintext in flight — `value-provenance-filter-incomplete` latches after a staged source
 * registry decrypted real entries it then could not narrow to the value, so the plaintext existed
 * in-process without ever activating. Membership here requires the stronger claim.
 *
 * The claim holds for each member: an absent or declared-incomplete envelope carries no entries
 * (the envelope schema rejects incomplete-with-entries), so nothing was decrypted; a registry
 * built without a catalog or without a persisted log never handled material; a durable read that
 * latched did so before importing anything; and the inherited markers never occur alone — the
 * source's own reasons are copied first, so they are judged by the originals they accompany.
 *
 * Consumers use this to separate `unrecorded` (absence — readable under the fail-open policy)
 * from taint at a write decision. A reason outside this set keeps the taint.
 */
const PROVENANCE_ABSENCE_REASONS = new Set<ResolvedSecretIncompletenessReason>([
  'value-provenance-absent',
  'source-provenance-incomplete',
  'constructed-incomplete',
  'log-creation-skipped',
  'durable-provenance-unknown',
  'inherited-incomplete-source',
  'inherited-incomplete-input-path',
])

/** True when {@link PROVENANCE_ABSENCE_REASONS} holds the reason; see its contract. */
export function isResolvedSecretProvenanceAbsence(
  reason: ResolvedSecretIncompletenessReason
): boolean {
  return PROVENANCE_ABSENCE_REASONS.has(reason)
}

const ORIGINATING_FAULT_REASONS = new Set<ResolvedSecretIncompletenessReason>([
  'untrusted-provenance',
  'entry-decrypt-failed',
  'unverified-resolved-entry',
  'projection-mismatch',
  'unresolved-placeholder',
  'provenance-capacity-exceeded',
  'tool-call-scope-mismatch',
  'value-provenance-untrusted',
  'value-provenance-import-failed',
  'durable-provenance-malformed',
  'tool-input-not-enumerable',
  'tool-params-transform-failed',
  'structural-input-projection-incomplete',
  'mothership-provenance-invalid',
  'client-tool-seal-failed',
  'knowledge-row-missing',
  'knowledge-row-content-mismatch',
  'mothership-response-unreadable',
  'structural-input-root-unprojected',
  'backfill-checkpoint-unusable',
])

/**
 * Incompleteness that is a construction choice rather than an event: `createIncomplete…` states
 * outright that no trusted catalog was available. It carries nothing a reader could act on and sits
 * on hot paths, so it is not reported at all.
 */
const BY_DESIGN_INCOMPLETENESS_REASONS = new Set<ResolvedSecretIncompletenessReason>([
  'constructed-incomplete',
  /** A session that will not persist a log has nothing to vouch for; it fires on every such run. */
  'log-creation-skipped',
])

/**
 * Sole owner of the report level, shared by every latch that reports one.
 *
 * The registry, its input paths, and the accumulator each latch for their own reasons but classify
 * them identically, and a copy of the split per latch is a copy that can be updated alone — which
 * would let the same reason be a fault in one place and routine in another.
 */
function reportIncompleteness(
  message: string,
  reason: ResolvedSecretIncompletenessReason,
  details: Record<string, unknown>
): void {
  if (BY_DESIGN_INCOMPLETENESS_REASONS.has(reason)) return
  /**
   * `reason` is written last so no detail can displace it. It is the field these lines are
   * queried and alerted on, and it also selects the level above — a payload whose `reason` says
   * one thing while the level was chosen from another is worse than no detail at all.
   */
  if (ORIGINATING_FAULT_REASONS.has(reason)) logger.error(message, { ...details, reason })
  else logger.warn(message, { ...details, reason })
}

/**
 * Origins are caller-supplied strings rather than a closed union, so they carry an explicit bound;
 * one run reaching this many distinct importers already tells the whole story.
 */
const MAX_RETAINED_ORIGINS = 8

/**
 * Why a registry can no longer vouch for what it projects, readable at the point a projection is
 * refused rather than only when the guard trips.
 *
 * A refusal is often many frames — and sometimes a whole process — away from the guard that caused
 * it, and the one-way latch means the causing call has long since returned. Without this, a run
 * that inherits an already-incomplete registry can refuse with nothing recorded anywhere.
 */
export interface ResolvedSecretIncompletenessDiagnostics {
  /** Distinct reasons in first-occurrence order, so the first is what originally cost completeness. */
  readonly reasons: readonly ResolvedSecretIncompletenessReason[]
  /** Callers that imported an untrustworthy bundle, in first-occurrence order. */
  readonly origins: readonly string[]
  readonly incompleteInputPathCount: number
  /** Present so a refusal record joins to the mark-time record that shares these counts. */
  readonly activeEntryCount: number
  /** Correlates a refusal with the guard that caused it; never carries user or secret material. */
  readonly scopeWorkspaceId?: string
  /**
   * Where the first guard tripped, carried alongside the reason that named it.
   *
   * A refusal is often frames away from its cause, which is why this struct exists — but it only
   * ever carried *what* went wrong, so a downstream reporter printed a reason with no location and
   * a reader had to join to the registry's own line to find the block.
   */
  readonly detail?: MarkIncompleteDetail
}

export const ANONYMOUS_SECRET_TRACE_REPLACEMENT = OPAQUE_RESOLVED_SECRET_REPLACEMENT
export const RESOLVED_SECRET_TRACE_CHECKPOINT_VERSION = 1

/**
 * The envelope for content no secret ever reached: vouched for, naming nothing.
 *
 * Distinct from an incomplete envelope, which says the opposite — that something may be carried
 * and cannot be named. A boundary that knows nothing was resolved should say so with this rather
 * than latch, since latching is the claim that redaction is impossible. Returned fresh so no
 * caller shares a value it may serialize or extend.
 */
export function emptyResolvedSecretTraceProvenance(): ResolvedSecretTraceProvenanceV1 {
  return { version: 1, complete: true, entries: [] }
}

const MAX_PROVENANCE_ENTRIES = PROVENANCE_MAX_ENTRIES
const MAX_SERIALIZED_PROVENANCE_BYTES = PROVENANCE_MAX_SERIALIZED_BYTES
const MAX_TRACE_CATALOG_ENTRIES = PROVENANCE_MAX_ENTRIES
const MAX_TRACE_CATALOG_BYTES = PROVENANCE_MAX_SERIALIZED_BYTES
const MAX_PROVENANCE_FILTER_NODES = 50_000
const MAX_PROVENANCE_FILTER_CHARACTERS = MAX_INLINE_MATERIALIZATION_BYTES
const MAX_PROVENANCE_FILTER_MATCH_EVENTS = 1_000_000
const LEGACY_RUNTIME_ALIAS_PATTERN = /__var_[A-Za-z0-9_]+/g
const ERROR_CONTENT_PROPERTY_NAMES = ['name', 'message', 'stack', 'cause', 'errors'] as const
const PROVENANCE_PROPERTY_NAMES = new Set(['version', 'complete', 'entries', 'scope'])
const PROVENANCE_ENTRY_PROPERTY_NAMES = new Set(['encryptedValue', 'name'])
const PROVENANCE_SCOPE_PROPERTY_NAMES = new Set(['userId', 'workspaceId'])

/** Which environment a catalog entry's value came from, when that is known. */
export type ResolvedSecretScope = 'workspace' | 'personal'

/** One secret a run resolved, identified the way the usage trail is keyed. */
export interface ResolvedSecretUsageEntry {
  name: string
  scope: ResolvedSecretScope
  /** The owning user for a personal secret; null for a workspace one. */
  ownerUserId: string | null
}

export interface ResolvedSecretTraceCatalogEntry {
  name: string
  plaintext: string
  encryptedValue: string
  /**
   * Optional because only a run's own effective catalog knows it. Entries adopted from an
   * imported provenance envelope carry a name but no scope, and are deliberately left
   * unattributed — the sub-run or tool call they crossed from records its own usage, so
   * attributing them here would double-count.
   */
  scope?: ResolvedSecretScope
  /**
   * Whose personal environment a `personal` entry came from. Required to tell two people's
   * same-named personal secrets apart, and NOT the same as the run's actor: a personal
   * secret shared with the workspace resolves for a caller who does not own it, and a
   * scheduled run resolves the workflow owner's personal slice under a different actor.
   * Unset for workspace entries, which the workspace itself owns.
   */
  ownerUserId?: string
  /**
   * Set only on workspace entries whose credential row opts the secret out of redaction.
   * Never trusted off an entry directly at decision time — every exemption re-derives
   * through the catalog by name AND plaintext, so an entry adopted from an imported
   * envelope is exempt only when it is byte-identical to the run's own flagged secret.
   */
  unredacted?: true
}

export interface ResolvedSecretTraceMatch {
  plaintext: string
  replacement: string
}

export type ResolvedSecretInputPath = readonly string[]

export type ResolvedSecretInputProjection =
  | { complete: true; value: Record<string, unknown> }
  | { complete: false }

export type ResolvedSecretModelEgressSnapshot =
  | { complete: true; matches: readonly ResolvedSecretTraceMatch[] }
  | { complete: false }

export type ResolvedSecretModelReferenceResolution<T> =
  | {
      complete: true
      matched: boolean
      value: T
      registry: ResolvedSecretTraceRegistry
    }
  | { complete: false }

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

interface ResolvedInputPathState {
  path: string[]
  entryKeys: Set<string>
  rawValue?: unknown
  projectedValue?: unknown
}

interface PreparedProvenanceFilter {
  candidatesByScanLiteral: ReadonlyMap<string, readonly ActiveSecretEntry[]>
  candidatesByAlias: ReadonlyMap<string, readonly ActiveSecretEntry[]>
  candidateEntries: ReadonlyMap<string, ActiveSecretEntry>
  matcher?: ResolvedSecretMatcher
}

/**
 * Carries the candidate entries on both arms, because they are the answer whenever narrowing is
 * unavailable — including when the matcher itself could not be built.
 */
type PreparedProvenanceFilterResult =
  | { complete: true; filter: PreparedProvenanceFilter }
  | { complete: false; candidateEntries: ReadonlyMap<string, ActiveSecretEntry> }

/** Extra attribution for a latch: which registry it propagated from, and which importer caused it. */
interface MarkIncompleteContext {
  source?: ResolvedSecretTraceRegistry
  /**
   * Which importer accepted an already-incomplete bundle — only meaningful where several callers
   * share one guard, as {@link ImportResolvedSecretTraceProvenanceOptions.origin} describes.
   *
   * It is not a second way to say what `reason` says. A latch that reaches for an origin because no
   * reason fits is the signal to add a reason literal instead: `reason` is a closed set that can be
   * alerted on and aggregated, and splitting the same fact across two fields leaves neither
   * trustworthy. Passing `'unspecified'` alongside an origin is the shape that produced a
   * production latch naming no guard at all.
   */
  origin?: string
  detail?: MarkIncompleteDetail
}

/**
 * Structural facts locating where a guard tripped. `reason` says what went wrong and this says
 * where, which is the difference between a line you can act on and one you can only count.
 *
 * Named fields rather than an open record, for the reason `reason` itself is a closed union: a
 * shape a caller can extend freely cannot be aggregated, and — because these merge into the
 * reported payload — an open record also lets a caller land a key that a reader takes to mean
 * something else, `origin` and `reason` being the two that carry the most weight here.
 *
 * Names and types only — never a value, and never a caught error's message. Code that throws while
 * coercing an input routinely quotes that input back (`JSON.parse` names the text it rejected), and
 * an input reaching one of these guards may still hold a resolved secret. That is the same promise
 * `reason` already makes about this log, restated where it is easy to break.
 */
export interface MarkIncompleteDetail {
  /** Block type id, e.g. `api`. */
  blockType?: string
  /** Tool id, e.g. `http_request`. */
  tool?: string
  /** Dotted input path within the block's inputs, e.g. `body.payload`. */
  inputPath?: string
  /** Error class only, e.g. `SyntaxError` — never the thrown message. */
  failure?: string
}

export interface ImportResolvedSecretTraceProvenanceOptions {
  trusted: boolean
  anonymous?: boolean
  /**
   * Stable dotted identifier for the caller, e.g. `workflowHandler.childCrossing`.
   *
   * A bundle that arrives already incomplete condemns the whole run, and the reason alone cannot
   * say which of the many importers accepted it. Recording the caller is what turns
   * `source-provenance-incomplete` from a symptom into an address.
   */
  origin?: string
}

export interface ExportResolvedSecretTraceProvenanceForValueOptions {
  anonymous?: boolean
}

export interface ImportResolvedSecretTraceProvenanceForValueResult {
  success: boolean
  matched: boolean
}

export interface CreateResolvedSecretTraceRegistryOptions {
  personalEncrypted: Record<string, string>
  workspaceEncrypted: Record<string, string>
  personalDecrypted: Record<string, string>
  workspaceDecrypted: Record<string, string>
  decryptionFailures?: readonly string[]
  /** `envKey` → owning user, from the environment snapshot; only personal keys appear. */
  personalOwners?: Record<string, string>
  restoredProvenance?: unknown
  restoredCheckpointVersion?: unknown
  restoreTrusted?: boolean
  requireRestoredProvenance?: boolean
  scope?: ResolvedSecretTraceScopeV1
  /**
   * Workspace env keys flagged `unredacted` on their credential row, from
   * {@link EnvironmentResolutionSnapshot.workspaceUnredactedKeys}. Stamps the matching
   * workspace catalog entries so their resolved values render in plaintext instead of
   * `{{NAME}}` and are omitted from exported provenance envelopes.
   */
  workspaceUnredactedKeys?: readonly string[]
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

function createLegacyRuntimeAlias(name: string): string {
  return `__var_${name.replace(/[^a-zA-Z0-9_]/g, '_')}`
}

function activeEntryKey(entry: ActiveSecretEntry): string {
  return entry.anonymous
    ? `anonymous\u0000${entry.encryptedValue}`
    : `named\u0000${entry.name}\u0000${entry.encryptedValue}`
}

function inputPathKey(path: ResolvedSecretInputPath): string {
  return JSON.stringify(path)
}

function isInputPathWithin(path: readonly string[], root: readonly string[]): boolean {
  return root.length <= path.length && root.every((segment, index) => segment === path[index])
}

function inputPathsOverlap(left: readonly string[], right: readonly string[]): boolean {
  return isInputPathWithin(left, right) || isInputPathWithin(right, left)
}

const EMPTY_GROUP_MATCH: readonly number[] = []

/**
 * Indices of every group whose root sits at or above `path`.
 *
 * The prefix form of {@link isInputPathWithin}, read from an index of the roots rather than by
 * testing each one. Scanning the roots per path is what forced a cap on how many a caller could
 * vouch for at once; walking `path`'s own prefixes is bounded by its depth instead.
 *
 * Copies on the first hit rather than aliasing, because the caller owns the index and a returned
 * alias would let an append mutate it.
 */
function groupsAlongInputPath(
  groupsByRoot: ReadonlyMap<string, readonly number[]>,
  path: ResolvedSecretInputPath
): readonly number[] {
  let matched: number[] | undefined
  for (let length = 0; length <= path.length; length += 1) {
    const indices = groupsByRoot.get(inputPathKey(path.slice(0, length)))
    if (!indices) continue
    if (!matched) matched = [...indices]
    else matched.push(...indices)
  }
  return matched ?? EMPTY_GROUP_MATCH
}

function readInputPath(root: unknown, path: readonly string[]): unknown {
  let current = root
  for (const segment of path) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

function writeInputPathOnProjectedCopy(
  sourceRoot: Record<string, unknown>,
  projectedRoot: Record<string, unknown>,
  path: readonly string[],
  value: unknown,
  projectedContainers: WeakMap<object, object>
): boolean {
  if (path.length === 0) return false
  let source: unknown = sourceRoot
  let projected: unknown = projectedRoot
  for (let index = 0; index < path.length - 1; index++) {
    if (
      source === null ||
      typeof source !== 'object' ||
      projected === null ||
      typeof projected !== 'object'
    ) {
      return false
    }
    const sourceChild = (source as Record<string, unknown>)[path[index]]
    if (sourceChild === null || typeof sourceChild !== 'object') return false
    let projectedChild = projectedContainers.get(sourceChild)
    if (!projectedChild) {
      projectedChild = Array.isArray(sourceChild)
        ? [...sourceChild]
        : { ...(sourceChild as Record<string, unknown>) }
      projectedContainers.set(sourceChild, projectedChild)
    }
    ;(projected as Record<string, unknown>)[path[index]] = projectedChild
    source = sourceChild
    projected = projectedChild
  }
  if (projected === null || typeof projected !== 'object') return false
  ;(projected as Record<string, unknown>)[path.at(-1)!] = value
  return true
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

function catalogEntryByteSize(entry: ResolvedSecretTraceCatalogEntry): number {
  return (
    Buffer.byteLength(entry.name, 'utf8') +
    Buffer.byteLength(entry.plaintext, 'utf8') +
    Buffer.byteLength(entry.encryptedValue, 'utf8')
  )
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

function buildEffectiveCatalogEntry(
  options: CreateResolvedSecretTraceRegistryOptions,
  failedNames: ReadonlySet<string>,
  unredactedNames: ReadonlySet<string>,
  name: string,
  encryptedValue: string
): ResolvedSecretTraceCatalogEntry | undefined {
  const fromWorkspace = hasOwn(options.workspaceDecrypted, name)
  const plaintext = fromWorkspace
    ? options.workspaceDecrypted[name]
    : options.personalDecrypted[name]
  if (plaintext === undefined || (plaintext.length === 0 && failedNames.has(name))) {
    return undefined
  }
  /**
   * Scope follows the value that actually won, matching the workspace-shadows-personal
   * precedence the merged environment applies. A name present in both must not be
   * attributed to the personal secret it shadowed.
   */
  if (fromWorkspace) {
    return {
      name,
      plaintext,
      encryptedValue,
      scope: 'workspace',
      /**
       * Stamped only on the workspace branch: a personal secret shadowed by a flagged
       * workspace name must not inherit the flag, and a personal value that WON the
       * name can never carry it.
       */
      ...(unredactedNames.has(name) ? { unredacted: true as const } : {}),
    }
  }

  const ownerUserId = options.personalOwners?.[name]
  return {
    name,
    plaintext,
    encryptedValue,
    scope: 'personal',
    ...(ownerUserId ? { ownerUserId } : {}),
  }
}

function* iterateEffectiveCatalogEntries(
  options: CreateResolvedSecretTraceRegistryOptions,
  failedNames: ReadonlySet<string>
): Generator<ResolvedSecretTraceCatalogEntry> {
  const unredactedNames = new Set(options.workspaceUnredactedKeys ?? [])
  for (const name in options.personalEncrypted) {
    if (!hasOwn(options.personalEncrypted, name)) continue
    const encryptedValue = hasOwn(options.workspaceEncrypted, name)
      ? options.workspaceEncrypted[name]
      : options.personalEncrypted[name]
    const entry = buildEffectiveCatalogEntry(
      options,
      failedNames,
      unredactedNames,
      name,
      encryptedValue
    )
    if (entry) yield entry
  }

  for (const name in options.workspaceEncrypted) {
    if (!hasOwn(options.workspaceEncrypted, name) || hasOwn(options.personalEncrypted, name)) {
      continue
    }
    const entry = buildEffectiveCatalogEntry(
      options,
      failedNames,
      unredactedNames,
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
  private reportedGuard = false

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
      entries: [...entries.values()].sort(
        (left, right) =>
          compareStrings(left.name ?? '', right.name ?? '') ||
          compareStrings(left.encryptedValue, right.encryptedValue)
      ),
      ...(this.scope ? { scope: cloneProvenanceScope(this.scope) } : {}),
    }
    if (!isResolvedSecretTraceProvenanceV1(merged)) {
      this.provenance = this.emptyProvenance(false)
      return false
    }

    this.provenance = merged
    return true
  }

  /**
   * Marks the invocation incomplete and discards entries that can no longer be trusted.
   *
   * `reason` is required for the same purpose it is on {@link ResolvedSecretTraceRegistry}, and
   * matters more here: the wire format carries only `complete`, so the consumer that imports this
   * bundle can only latch with `source-provenance-incomplete` and can never name the guard. This
   * line is the sole record of which one tripped.
   *
   * Only the first guard reports. Later ones restate an invocation that already cannot vouch, and
   * a caller walking a list of sources would otherwise emit a line per remaining source. A latch
   * from {@link record} does not report at all: it reflects a bundle whose own registry already
   * reported, so this would only restate it with less context.
   */
  markIncomplete(reason: ResolvedSecretIncompletenessReason): void {
    this.provenance = this.emptyProvenance(false)
    if (this.reportedGuard) return
    this.reportedGuard = true
    reportIncompleteness('Resolved secret provenance accumulator marked incomplete', reason, {
      scopeWorkspaceId: this.scope?.workspaceId,
    })
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
 * Owns the execution's bounded secret catalog and activated cross-boundary provenance.
 * The catalog verifies explicit resolutions and trusted runtime-boundary scans. Trace and model
 * projection use only entries that those boundaries have activated, so unrelated configured
 * values cannot alter otherwise public content merely because their bytes happen to match.
 */
export class ResolvedSecretTraceRegistry {
  private readonly catalog = new Map<string, ResolvedSecretTraceCatalogEntry>()
  private catalogBytes = 0
  private readonly activeEntries = new Map<string, ActiveSecretEntry>()
  private readonly propagatedEntryKeys = new Set<string>()
  private readonly resolvedInputPaths = new Map<string, ResolvedInputPathState>()
  private readonly incompleteInputPaths = new Map<string, string[]>()
  /** Insertion-ordered; see {@link ResolvedSecretIncompletenessDiagnostics}. */
  private readonly incompletenessReasons = new Set<ResolvedSecretIncompletenessReason>()
  /** Import callers that cost this registry its completeness; bounded by {@link MAX_RETAINED_ORIGINS}. */
  private readonly incompletenessOrigins = new Set<string>()
  /** First guard's location; later ones describe propagation, not the cause. */
  private incompletenessDetail: MarkIncompleteDetail | undefined
  private activeProvenanceEntryBytes = 0
  private complete = true
  private pendingActivations = 0
  private modelEgressRevision = 0
  private activeProvenanceFilterCache?: {
    revision: number
    result: PreparedProvenanceFilterResult
  }
  private readonly scope?: ResolvedSecretTraceScopeV1
  private readonly completeProvenanceEnvelopeBytes: number
  /**
   * A staged registry filters values for one operation and is then discarded. Its caller owns the
   * reporting and says it with strictly more context — the real input path for a value filter, the
   * execution for a display read — so the registry's own summary lines would only restate it.
   * Entry-level detail still logs — the caller cannot reconstruct it.
   */
  private readonly staged: boolean
  /**
   * Plaintexts a fork's parent was protecting when the fork was cut. A fork copies an
   * active-entry SUBSET, so a non-exempt entry sharing an unredacted entry's plaintext can be
   * left behind — and without this set the fork would emit bytes the parent's own log renders
   * redacted. Collision decisions consult this set alongside the fork's own entries, so the
   * exemption can only ever narrow across a fork, never widen.
   */
  private readonly inheritedProtectedPlaintexts: ReadonlySet<string>

  constructor(
    catalogEntries: Iterable<ResolvedSecretTraceCatalogEntry> = [],
    scope?: ResolvedSecretTraceScopeV1,
    options: { staged?: boolean; inheritedProtectedPlaintexts?: ReadonlySet<string> } = {}
  ) {
    this.staged = options.staged === true
    this.inheritedProtectedPlaintexts = options.inheritedProtectedPlaintexts ?? new Set()
    this.scope = scope ? cloneProvenanceScope(scope) : undefined
    this.completeProvenanceEnvelopeBytes = serializedProvenanceEnvelopeByteSize(true, this.scope)
    if (this.completeProvenanceEnvelopeBytes > MAX_SERIALIZED_PROVENANCE_BYTES) {
      this.markIncomplete('provenance-capacity-exceeded')
    }
    let catalogEntriesSeen = 0
    for (const entry of catalogEntries) {
      catalogEntriesSeen++
      if (catalogEntriesSeen > MAX_TRACE_CATALOG_ENTRIES) break
      this.addCatalogEntry(entry)
    }
  }

  /**
   * Creates an isolated registry for one tool call.
   *
   * Active/catalogued values are copied, but temporary activation guards are not: a sibling
   * tool that is still resolving a secret must not suppress this call's otherwise safe result.
   * The caller must merge the child back after settlement so newly activated provenance remains
   * available to later calls in the run.
   */
  forkForToolCall(): ResolvedSecretTraceRegistry {
    const fork = new ResolvedSecretTraceRegistry(this.catalog.values(), this.scope, {
      inheritedProtectedPlaintexts: this.collectProtectedPlaintexts(),
    })
    for (const entry of this.activeEntries.values()) {
      fork.addActiveEntry(
        { ...entry },
        { propagated: this.propagatedEntryKeys.has(activeEntryKey(entry)) }
      )
    }
    this.copyResolvedInputPathsTo(fork)
    this.copyIncompleteInputPathsTo(fork)
    if (!this.complete) fork.markIncomplete('inherited-incomplete-source', { source: this })
    return fork
  }

  /** Creates an isolated registry from resolver-recorded input paths without plaintext matching. */
  forkForInputPaths(
    paths: readonly ResolvedSecretInputPath[],
    options: { propagated?: boolean } = {}
  ): ResolvedSecretTraceRegistry {
    const fork = new ResolvedSecretTraceRegistry(this.catalog.values(), this.scope, {
      inheritedProtectedPlaintexts: this.collectProtectedPlaintexts(),
    })
    if (!this.complete) {
      fork.markIncomplete('inherited-incomplete-source', { source: this })
      return fork
    }

    if (this.hasIncompleteInputPathOverlapping(paths)) {
      fork.markIncomplete('inherited-incomplete-input-path', { source: this })
      return fork
    }

    const selectedKeys = this.collectInputPathEntryKeys(paths)
    for (const [key, entry] of this.activeEntries) {
      if (!selectedKeys.has(key)) continue
      fork.addActiveEntry(
        { ...entry },
        { propagated: options.propagated === true || this.propagatedEntryKeys.has(key) }
      )
    }
    this.copyResolvedInputPathsTo(fork, paths)
    return fork
  }

  /** Creates a model/output registry containing only provenance explicitly carried by a result. */
  forkForPropagatedEntries(): ResolvedSecretTraceRegistry {
    const fork = new ResolvedSecretTraceRegistry(this.catalog.values(), this.scope, {
      inheritedProtectedPlaintexts: this.collectProtectedPlaintexts(),
    })
    for (const entry of this.activeEntries.values()) {
      if (this.propagatedEntryKeys.has(activeEntryKey(entry))) {
        fork.addActiveEntry({ ...entry }, { propagated: true })
      }
    }
    if (this.isPermanentlyIncomplete())
      fork.markIncomplete('inherited-incomplete-source', { source: this })
    return fork
  }

  /**
   * Rebinds environment placeholders that were actually projected into a model request.
   *
   * The model receives `{{NAME}}`, never the plaintext. A later tool argument may carry that
   * placeholder back verbatim. Only named entries attached to a resolver-recorded projected input
   * are eligible here, so inventing another workspace variable name does not grant access to it.
   * The returned registry contains only references used by this tool call.
   */
  resolveModelExposedEnvReferences<T>(value: T): ResolvedSecretModelReferenceResolution<T> {
    if (!this.complete) return { complete: false }

    const projectedValueContains = (candidate: unknown, placeholder: string): boolean => {
      const pending = [candidate]
      const visited = new WeakSet<object>()
      while (pending.length > 0) {
        const current = pending.pop()
        if (typeof current === 'string' && current.includes(placeholder)) return true
        if (current === null || typeof current !== 'object' || visited.has(current)) continue
        visited.add(current)
        pending.push(...Object.values(current))
      }
      return false
    }

    const exposedEntriesByName = new Map<string, ActiveSecretEntry>()
    for (const state of this.resolvedInputPaths.values()) {
      if (state.projectedValue === undefined) continue
      for (const entryKey of state.entryKeys) {
        const entry = this.activeEntries.get(entryKey)
        if (
          !entry ||
          entry.anonymous ||
          entry.name.length === 0 ||
          !projectedValueContains(state.projectedValue, `{{${entry.name}}}`)
        ) {
          continue
        }
        const existing = exposedEntriesByName.get(entry.name)
        if (existing && existing.plaintext !== entry.plaintext) return { complete: false }
        exposedEntriesByName.set(entry.name, entry)
      }
    }

    const registry = new ResolvedSecretTraceRegistry(this.catalog.values(), this.scope, {
      inheritedProtectedPlaintexts: this.collectProtectedPlaintexts(),
    })
    let matched = false
    const resolve = (candidate: unknown, path: string[]): unknown => {
      if (typeof candidate === 'string') {
        const usedEntries = new Map<string, ActiveSecretEntry>()
        const resolved = candidate.replace(/\{\{([^{}]+)\}\}/g, (placeholder, rawName) => {
          const name = String(rawName).trim()
          const entry = exposedEntriesByName.get(name)
          if (!entry) return placeholder
          usedEntries.set(activeEntryKey(entry), entry)
          return entry.plaintext
        })
        if (usedEntries.size === 0) return candidate

        matched = true
        for (const entry of usedEntries.values()) {
          registry.addActiveEntry({ ...entry }, { propagated: true })
        }
        registry.bindResolvedInputPathEntries(path, usedEntries.values())
        registry.recordResolvedInputProjection(path, resolved, candidate)
        return resolved
      }
      if (Array.isArray(candidate)) {
        return candidate.map((item, index) => resolve(item, [...path, String(index)]))
      }
      if (candidate === null || typeof candidate !== 'object') return candidate

      const resolved: Record<string, unknown> = {}
      for (const [key, child] of Object.entries(candidate)) {
        resolved[key] = resolve(child, [...path, key])
      }
      return resolved
    }

    const resolvedValue = resolve(value, []) as T
    return {
      complete: true,
      matched,
      value: resolvedValue,
      registry,
    }
  }

  /** Merges one settled tool-call registry into the turn-scoped registry. */
  mergeToolCallRegistry(child: ResolvedSecretTraceRegistry): void {
    if (!scopesMatch(this.scope, child.scope)) {
      this.markIncomplete('tool-call-scope-mismatch')
      return
    }

    if (!child.isComplete()) {
      this.markIncomplete('inherited-incomplete-source', { source: child })
      return
    }

    for (const entry of child.activeEntries.values()) {
      this.addActiveEntry(
        { ...entry },
        { propagated: child.propagatedEntryKeys.has(activeEntryKey(entry)) }
      )
    }
    child.copyResolvedInputPathsTo(this)
  }

  /** Activates a configured secret only when the resolved runtime value matches its catalog value. */
  recordResolved(
    name: string,
    resolvedValue: string,
    options: { propagated?: boolean } = {}
  ): boolean {
    if (resolvedValue.length === 0) return false
    const entry = this.getVerifiedResolvedEntry(name, resolvedValue)
    if (!entry) {
      this.markIncomplete('unverified-resolved-entry')
      return false
    }

    this.addActiveEntry(entry, options)
    return true
  }

  /** Records the exact resolved input leaf that activated a configured secret. */
  recordResolvedAtInputPath(
    name: string,
    resolvedValue: string,
    path: ResolvedSecretInputPath | undefined,
    options: { propagated?: boolean } = {}
  ): boolean {
    if (!path || path.length === 0) return this.recordResolved(name, resolvedValue, options)
    if (resolvedValue.length === 0) return false

    const entry = this.getVerifiedResolvedEntry(name, resolvedValue)
    if (!entry) {
      this.markInputPathIncomplete(path, 'unverified-resolved-entry')
      return false
    }

    this.addActiveEntry(entry, options)
    this.bindResolvedInputPathEntries(path, [entry])
    return true
  }

  private getVerifiedResolvedEntry(
    name: string,
    resolvedValue: string
  ): ActiveSecretEntry | undefined {
    const catalogEntry = this.catalog.get(name)
    return catalogEntry?.plaintext === resolvedValue
      ? { ...catalogEntry, anonymous: false }
      : undefined
  }

  private bindResolvedInputPathEntries(
    path: ResolvedSecretInputPath,
    entries: Iterable<ActiveSecretEntry>
  ): void {
    const key = inputPathKey(path)
    const state = this.resolvedInputPaths.get(key) ?? {
      path: [...path],
      entryKeys: new Set<string>(),
    }
    for (const entry of entries) state.entryKeys.add(activeEntryKey(entry))
    this.resolvedInputPaths.set(key, state)
  }

  /** Stores the exact placeholder-preserving copy produced while resolving one string leaf. */
  recordResolvedInputProjection(
    path: ResolvedSecretInputPath | undefined,
    rawValue: unknown,
    projectedValue: unknown
  ): void {
    if (!path || path.length === 0) return
    const key = inputPathKey(path)
    const state = this.resolvedInputPaths.get(key)
    if (!state || state.entryKeys.size === 0) return
    state.rawValue = rawValue
    state.projectedValue = projectedValue
  }

  /** Returns whether the resolver recorded any placeholder-preserving input copies. */
  hasResolvedInputProjections(): boolean {
    for (const state of this.resolvedInputPaths.values()) {
      if (state.rawValue !== undefined && state.projectedValue !== undefined) return true
    }
    return false
  }

  /**
   * Carries resolver-recorded provenance through one deterministic block-parameter transform.
   *
   * The caller supplies the real transformed params and the result of applying the same transform
   * to the resolver's placeholder-preserving input copy. Only canonical placeholders in that
   * private projected copy establish the mapping; raw values are never searched or rewritten.
   */
  recordTransformedInputProjection(
    rawTransformed: Record<string, unknown>,
    projectedTransformed: Record<string, unknown>,
    options: { targetPaths?: readonly ResolvedSecretInputPath[] } = {}
  ): void {
    if (!this.complete) return

    const eligibleEntryKeys = new Set<string>()
    for (const state of this.resolvedInputPaths.values()) {
      if (state.rawValue === undefined || state.projectedValue === undefined) continue
      for (const entryKey of state.entryKeys) eligibleEntryKeys.add(entryKey)
    }
    if (eligibleEntryKeys.size === 0) return

    const entryKeysByName = new Map<string, Set<string>>()
    for (const entryKey of eligibleEntryKeys) {
      const entry = this.activeEntries.get(entryKey)
      if (!entry || entry.anonymous || entry.name.length === 0) continue
      const keys = entryKeysByName.get(entry.name) ?? new Set<string>()
      keys.add(entryKey)
      entryKeysByName.set(entry.name, keys)
    }
    if (entryKeysByName.size === 0) return

    const canonicalPlaceholderName = (value: string): string | undefined => {
      const match = /^\{\{([^{}]+)\}\}$/.exec(value.trim())
      if (!match) return undefined
      const name = match[1].trim()
      return /^[A-Za-z0-9_]+$/.test(name) ? name : undefined
    }

    const placeholderEntryKeys = (value: unknown): Set<string> => {
      const keys = new Set<string>()
      if (typeof value !== 'string') return keys
      for (const match of value.matchAll(/\{\{([^{}]+)\}\}/g)) {
        const name = match[1].trim()
        if (!/^[A-Za-z0-9_]+$/.test(name)) continue
        for (const entryKey of entryKeysByName.get(name) ?? []) keys.add(entryKey)
      }
      return keys
    }

    const recordState = (
      path: string[],
      entryKeys: ReadonlySet<string>,
      rawValue: unknown,
      projectedValue: unknown
    ): void => {
      if (path.length === 0 || rawValue === undefined || projectedValue === undefined) return
      const key = inputPathKey(path)
      const state = this.resolvedInputPaths.get(key) ?? {
        path: [...path],
        entryKeys: new Set<string>(),
      }
      if (
        state.rawValue === rawValue &&
        typeof state.projectedValue === 'string' &&
        typeof projectedValue === 'string' &&
        state.projectedValue !== projectedValue
      ) {
        this.markInputPathIncomplete(path, 'projection-mismatch')
        return
      }
      for (const entryKey of entryKeys) state.entryKeys.add(entryKey)
      state.rawValue = rawValue
      state.projectedValue = projectedValue
      this.resolvedInputPaths.set(key, state)
    }

    const recordProjectedMarkerAcrossRawLeaves = (
      rawValue: unknown,
      projectedValue: string,
      path: string[],
      entryKeys: ReadonlySet<string>
    ): void => {
      const pending: Array<{ value: unknown; path: string[] }> = [{ value: rawValue, path }]
      const visited = new WeakSet<object>()
      while (pending.length > 0) {
        const current = pending.pop()!
        if (current.value === null || typeof current.value !== 'object') {
          recordState(current.path, entryKeys, current.value, projectedValue)
          continue
        }
        if (visited.has(current.value)) continue
        visited.add(current.value)
        for (const [key, value] of Object.entries(current.value)) {
          pending.push({ value, path: [...current.path, key] })
        }
      }
    }

    const pending: Array<{ raw: unknown; projected: unknown; path: string[] }> =
      options.targetPaths === undefined
        ? Object.keys(projectedTransformed).map((key) => ({
            raw: rawTransformed[key],
            projected: projectedTransformed[key],
            path: [key],
          }))
        : options.targetPaths
            .filter((path) => path.length > 0)
            .map((path) => ({
              raw: readInputPath(rawTransformed, path),
              projected: readInputPath(projectedTransformed, path),
              path: [...path],
            }))
    const visitedPairs = new WeakMap<object, WeakSet<object>>()

    while (pending.length > 0) {
      const current = pending.pop()!
      if (Object.is(current.raw, current.projected)) continue

      const projectedEntryKeys = placeholderEntryKeys(current.projected)
      if (projectedEntryKeys.size > 0) {
        if (current.raw !== null && typeof current.raw === 'object') {
          const standaloneName = canonicalPlaceholderName(current.projected as string)
          if (!standaloneName || !entryKeysByName.has(standaloneName)) {
            this.markInputPathIncomplete(current.path, 'unresolved-placeholder')
            return
          }
          recordProjectedMarkerAcrossRawLeaves(
            current.raw,
            current.projected as string,
            current.path,
            projectedEntryKeys
          )
        } else {
          recordState(current.path, projectedEntryKeys, current.raw, current.projected)
        }
        continue
      }

      if (
        current.raw === null ||
        typeof current.raw !== 'object' ||
        current.projected === null ||
        typeof current.projected !== 'object'
      ) {
        continue
      }

      const projectedObjectsSeen = visitedPairs.get(current.raw) ?? new WeakSet<object>()
      if (projectedObjectsSeen.has(current.projected)) continue
      projectedObjectsSeen.add(current.projected)
      visitedPairs.set(current.raw, projectedObjectsSeen)

      for (const key of Object.keys(current.projected)) {
        pending.push({
          raw: (current.raw as Record<string, unknown>)[key],
          projected: (current.projected as Record<string, unknown>)[key],
          path: [...current.path, key],
        })
      }
    }
  }

  /**
   * Whether a recorded input leaf still needs its placeholder projection applied. A leaf is
   * released to the model raw only when every entry that activated it is exempt and nothing
   * else protects those bytes; an entry key that no longer resolves keeps the projection —
   * fail closed, never open, on bookkeeping gaps.
   */
  private shouldProjectInputState(
    state: ResolvedInputPathState,
    protectedPlaintexts: ReadonlySet<string>
  ): boolean {
    if (state.entryKeys.size === 0) return true
    for (const entryKey of state.entryKeys) {
      const entry = this.activeEntries.get(entryKey)
      if (!entry) return true
      if (!this.isUnredactedEntry(entry)) return true
      if (protectedPlaintexts.has(entry.plaintext)) return true
    }
    return false
  }

  private projectResolvedInputStates(
    selected: Record<string, unknown>,
    states: Iterable<ResolvedInputPathState>
  ): ResolvedSecretInputProjection {
    const projected = { ...selected }
    const projectedContainers = new WeakMap<object, object>([[selected, projected]])
    const protectedPlaintexts = this.collectProtectedPlaintexts()

    for (const state of states) {
      if (state.rawValue === undefined || state.projectedValue === undefined) continue
      if (!Object.hasOwn(selected, state.path[0])) continue
      if (readInputPath(selected, state.path) !== state.rawValue) continue
      if (!this.shouldProjectInputState(state, protectedPlaintexts)) continue
      if (
        !writeInputPathOnProjectedCopy(
          selected,
          projected,
          state.path,
          state.projectedValue,
          projectedContainers
        )
      ) {
        return { complete: false }
      }
    }
    return { complete: true, value: projected }
  }

  /** Projects only resolver-recorded leaves and preserves every object key byte-for-byte. */
  projectResolvedInputSelection(selected: Record<string, unknown>): ResolvedSecretInputProjection {
    if (
      !this.complete ||
      this.hasIncompleteInputPathOverlapping(Object.keys(selected).map((key) => [key]))
    ) {
      return { complete: false }
    }
    return this.projectResolvedInputStates(selected, this.resolvedInputPaths.values())
  }

  /**
   * Produces one causal projection per resolved input path.
   *
   * Replaying transforms independently keeps a secret-valued discriminator from changing the
   * control flow used to trace a different secret-valued input.
   */
  projectResolvedInputSelections(selected: Record<string, unknown>):
    | {
        complete: true
        values: Array<{
          path: ResolvedSecretInputPath
          rawValue: unknown
          projectedValue: unknown
          value: Record<string, unknown>
        }>
      }
    | { complete: false } {
    if (
      !this.complete ||
      this.hasIncompleteInputPathOverlapping(Object.keys(selected).map((key) => [key]))
    ) {
      return { complete: false }
    }

    const values: Array<{
      path: ResolvedSecretInputPath
      rawValue: unknown
      projectedValue: unknown
      value: Record<string, unknown>
    }> = []
    for (const state of this.resolvedInputPaths.values()) {
      if (state.rawValue === undefined || state.projectedValue === undefined) continue
      if (!Object.hasOwn(selected, state.path[0])) continue
      if (readInputPath(selected, state.path) !== state.rawValue) continue
      const projection = this.projectResolvedInputStates(selected, [state])
      if (!projection.complete) return projection
      values.push({
        path: state.path,
        rawValue: state.rawValue,
        projectedValue: state.projectedValue,
        value: projection.value,
      })
    }
    return { complete: true, values }
  }

  /** Exports resolver-recorded provenance for selected input paths without inspecting values. */
  exportCommittedProvenanceForInputPaths(
    paths: readonly ResolvedSecretInputPath[],
    options: ExportResolvedSecretTraceProvenanceForValueOptions = {}
  ): ResolvedSecretTraceProvenanceV1 {
    return this.exportCommittedProvenanceForInputPathGroups([paths], options)[0]
  }

  /**
   * Exports resolver-recorded provenance for many input-path groups in a single pass.
   *
   * One group per cell a write vouches for. Called per group, each export rescans every resolved
   * input path and every active entry, so vouching for N cells cost O(N x paths) — and a wide
   * table write is exactly that shape. That cost is what a selection cap was really bounding, and
   * the cap failed the whole bundle rather than the work, so every row of an oversized write
   * landed `unknown` in its durable sidecar with nothing recorded about why.
   *
   * Indexing the group roots once makes the batch linear in the resolved paths and the active
   * entries, so there is no size at which a caller has to stop vouching. Groups are answered
   * independently and in order: an incomplete input path fails only the groups it overlaps, which
   * is the same per-group judgement the single-path form has always made.
   */
  exportCommittedProvenanceForInputPathGroups(
    groups: ReadonlyArray<readonly ResolvedSecretInputPath[]>,
    options: ExportResolvedSecretTraceProvenanceForValueOptions = {}
  ): ResolvedSecretTraceProvenanceV1[] {
    if (!this.complete) return groups.map(() => this.incompleteProvenance())

    const groupsByRoot = new Map<string, number[]>()
    groups.forEach((paths, index) => {
      for (const path of paths) {
        const key = inputPathKey(path)
        const existing = groupsByRoot.get(key)
        if (existing) existing.push(index)
        else groupsByRoot.set(key, [index])
      }
    })

    /**
     * Overlap is symmetric, so a group fails on an incomplete path at or below its root — matched
     * by walking that path — or at or above it, matched by walking the root's own prefixes.
     */
    const incompleteGroups = new Set<number>()
    for (const incompletePath of this.incompleteInputPaths.values()) {
      for (const index of groupsAlongInputPath(groupsByRoot, incompletePath)) {
        incompleteGroups.add(index)
      }
    }
    if (incompleteGroups.size < groups.length) {
      const incompleteRoots = new Set(this.incompleteInputPaths.keys())
      groups.forEach((paths, index) => {
        if (incompleteGroups.has(index)) return
        for (const path of paths) {
          for (let length = 0; length <= path.length; length += 1) {
            if (!incompleteRoots.has(inputPathKey(path.slice(0, length)))) continue
            incompleteGroups.add(index)
            return
          }
        }
      })
    }

    /**
     * Allocated per group only once that group actually selects something. A write whose cells
     * carry no secrets is the common case and the widest one, and it is the shape that used to
     * exceed the cap — it should not pay a collection per cell to say so.
     */
    const entryKeysByGroup: Array<Set<string> | undefined> = new Array(groups.length)
    for (const state of this.resolvedInputPaths.values()) {
      if (state.entryKeys.size === 0) continue
      for (const index of groupsAlongInputPath(groupsByRoot, state.path)) {
        if (incompleteGroups.has(index)) continue
        const selected = (entryKeysByGroup[index] ??= new Set<string>())
        for (const entryKey of state.entryKeys) selected.add(entryKey)
      }
    }

    /**
     * Inverted before the single walk of `activeEntries` so each group's entries keep that map's
     * insertion order, which is the order the per-group export produced and the order
     * {@link buildProvenanceEntries} breaks its ties on.
     */
    const groupsByEntryKey = new Map<string, number[]>()
    entryKeysByGroup.forEach((entryKeys, index) => {
      if (!entryKeys) return
      for (const entryKey of entryKeys) {
        const existing = groupsByEntryKey.get(entryKey)
        if (existing) existing.push(index)
        else groupsByEntryKey.set(entryKey, [index])
      }
    })
    const entriesByGroup: Array<ActiveSecretEntry[] | undefined> = new Array(groups.length)
    if (groupsByEntryKey.size > 0) {
      for (const [entryKey, entry] of this.activeEntries) {
        const indices = groupsByEntryKey.get(entryKey)
        if (!indices) continue
        for (const index of indices) (entriesByGroup[index] ??= []).push(entry)
      }
    }

    return groups.map((_, index) =>
      incompleteGroups.has(index)
        ? this.incompleteProvenance()
        : {
            version: 1,
            complete: true,
            entries: this.buildProvenanceEntries(entriesByGroup[index] ?? [], options.anonymous),
            ...(this.scope ? { scope: cloneProvenanceScope(this.scope) } : {}),
          }
    )
  }

  /** Imports encrypted provenance only from a boundary that has already established trust. */
  async importProvenance(
    provenance: unknown,
    options: ImportResolvedSecretTraceProvenanceOptions
  ): Promise<boolean> {
    if (!options.trusted || !isResolvedSecretTraceProvenanceV1(provenance)) {
      this.markIncomplete('untrusted-provenance', { origin: options.origin })
      return false
    }

    if (!provenance.complete) {
      this.markIncomplete('source-provenance-incomplete', { origin: options.origin })
    }

    const sameScope = scopesMatch(provenance.scope, this.scope)
    let importedAll = true
    let decryptFailures = 0
    let firstDecryptError: string | undefined
    for (const entry of provenance.entries) {
      try {
        const { decrypted } = await decryptSecret(entry.encryptedValue)
        this.addActiveEntry(
          {
            name: entry.name ?? '',
            plaintext: decrypted,
            encryptedValue: entry.encryptedValue,
            anonymous: options.anonymous === true || !sameScope || entry.name === undefined,
          },
          { propagated: true }
        )
      } catch (error) {
        importedAll = false
        decryptFailures += 1
        firstDecryptError ??= getErrorMessage(error, 'Unknown error')
        this.markIncomplete('entry-decrypt-failed', { origin: options.origin })
      }
    }

    /**
     * Summarised rather than logged per entry: one rotated or corrupt key fails every entry in the
     * bundle, and a bundle may carry up to MAX_PROVENANCE_ENTRIES of them.
     */
    if (decryptFailures > 0) {
      logger.error('Provenance entries could not be decrypted', {
        error: firstDecryptError,
        failedEntryCount: decryptFailures,
        totalEntryCount: provenance.entries.length,
        scopeWorkspaceId: this.scope?.workspaceId,
      })
    }

    return importedAll
  }

  /**
   * Imports only provenance whose decrypted plaintext occurs in the exact value crossing this
   * boundary. Staging in a scoped temporary registry prevents a valid but overbroad envelope from
   * activating unrelated entries, while scope comparison still anonymizes cross-scope values.
   */
  async importProvenanceForValue(
    provenance: unknown,
    value: unknown,
    options: { trusted: boolean; origin?: string }
  ): Promise<boolean> {
    const result = await this.importProvenanceForValueInternal(provenance, value, options)
    return result.success
  }

  /** Imports exact crossing provenance and binds only its matched entries to one resolved input. */
  async importProvenanceForValueAtInputPath(
    provenance: unknown,
    value: unknown,
    inputPath: ResolvedSecretInputPath | undefined,
    options: { trusted: boolean; origin?: string }
  ): Promise<ImportResolvedSecretTraceProvenanceForValueResult> {
    return this.importProvenanceForValueInternal(provenance, value, {
      ...options,
      inputPath,
    })
  }

  private async importProvenanceForValueInternal(
    provenance: unknown,
    value: unknown,
    options: { trusted: boolean; inputPath?: ResolvedSecretInputPath; origin?: string }
  ): Promise<ImportResolvedSecretTraceProvenanceForValueResult> {
    /**
     * Absence and distrust are different facts and are reported as such. A run that failed before
     * producing provenance hands this `undefined`, which is the expected shape of a failed
     * crossing, not a guard catching something wrong — reporting it as a fault put a recurring
     * by-design state at error level with a name that reads like a breach.
     */
    if (!options.trusted || !isResolvedSecretTraceProvenanceV1(provenance)) {
      const reason =
        options.trusted && provenance === undefined
          ? 'value-provenance-absent'
          : 'value-provenance-untrusted'
      this.markInputPathIncomplete(options.inputPath, reason, options.origin)
      return { success: false, matched: false }
    }

    const sourceRegistry = new ResolvedSecretTraceRegistry([], provenance.scope, { staged: true })
    const sourceImported = await sourceRegistry.importProvenance(provenance, {
      trusted: true,
      origin: options.origin,
    })
    const filteredProvenance = sourceRegistry.exportProvenanceForValue(value)
    if (!sourceImported) {
      this.markInputPathIncomplete(
        options.inputPath,
        'value-provenance-import-failed',
        options.origin
      )
      return { success: false, matched: false }
    }
    if (!filteredProvenance.complete) {
      this.markInputPathIncomplete(
        options.inputPath,
        provenance.complete ? 'value-provenance-filter-incomplete' : 'source-provenance-incomplete',
        options.origin
      )
      return { success: true, matched: false }
    }
    const filteredImported = await this.importProvenance(filteredProvenance, {
      trusted: true,
      origin: options.origin,
    })
    if (options.inputPath && options.inputPath.length > 0 && filteredProvenance.complete) {
      const sameScope = scopesMatch(filteredProvenance.scope, this.scope)
      this.bindResolvedInputPathEntries(
        options.inputPath,
        filteredProvenance.entries.flatMap((entry) => {
          const anonymous = !sameScope || entry.name === undefined
          const importedEntry = this.activeEntries.get(
            activeEntryKey({
              name: entry.name ?? '',
              plaintext: '',
              encryptedValue: entry.encryptedValue,
              anonymous,
            })
          )
          return importedEntry ? [importedEntry] : []
        })
      )
    }
    return {
      success: sourceImported && filteredImported,
      matched: filteredProvenance.complete && filteredProvenance.entries.length > 0,
    }
  }

  /** Imports only provenance present in the exact crossing value, preserving names in-scope. */
  async importCrossingProvenance(
    provenance: unknown,
    crossingValue: unknown,
    options: { trusted: boolean; origin?: string }
  ): Promise<boolean> {
    return this.importProvenanceForValue(provenance, crossingValue, options)
  }

  /** Returns deterministic literal replacements for the terminal TraceSpan projection. */
  getActiveMatches(): readonly ResolvedSecretTraceMatch[] {
    return this.buildMatches(this.activeEntries.values())
  }

  /**
   * Names the configured secrets this run actually resolved, for the usage trail.
   *
   * Only named entries from the run's own effective catalog qualify: an anonymous entry has
   * no name to attribute, and a named entry adopted from an imported envelope has no scope
   * because the sub-run it crossed from records its own usage. Deduplicated by name, scope,
   * and owner, since one secret can be activated at many input paths.
   *
   * A personal entry with no known owner is dropped rather than recorded unattributed: the
   * trail is read per owner, so an ownerless row would surface under someone else's
   * same-named secret.
   *
   * Carries no plaintext or ciphertext — the caller persists this, and a usage trail must
   * never become a second place a secret's value lives.
   */
  getResolvedSecretUsage(): ReadonlyArray<ResolvedSecretUsageEntry> {
    const usage = new Map<string, ResolvedSecretUsageEntry>()
    for (const entry of this.activeEntries.values()) {
      if (entry.anonymous || !entry.scope) continue
      if (entry.scope === 'personal' && !entry.ownerUserId) continue
      const ownerUserId = entry.scope === 'personal' ? (entry.ownerUserId as string) : null
      usage.set(`${entry.scope}\u0000${ownerUserId ?? ''}\u0000${entry.name}`, {
        name: entry.name,
        scope: entry.scope,
        ownerUserId,
      })
    }
    return [...usage.values()]
  }

  /**
   * Names the sandbox path may treat as exempt when classifying its exported files. The route
   * sees only names and cannot re-check collisions itself, so any flagged name whose plaintext
   * another catalog entry or a non-exempt active entry shares is withheld — the file export
   * then records the colliding owner's provenance exactly as before.
   *
   * Certifies nothing once the registry is permanently incomplete: the collision set is built
   * from the active entries, and a failed import or capacity latch means entries — including a
   * collider for a flagged plaintext — may be missing. The same bar model egress applies, and
   * for the same reason: incompleteness must only ever widen protection.
   */
  getUnredactedSecretNames(): readonly string[] {
    if (this.isPermanentlyIncomplete()) return []
    const protectedPlaintexts = this.collectProtectedPlaintexts()
    const nonExemptCatalogPlaintexts = new Set<string>()
    for (const entry of this.catalog.values()) {
      if (entry.unredacted !== true) nonExemptCatalogPlaintexts.add(entry.plaintext)
    }

    const names: string[] = []
    for (const entry of this.catalog.values()) {
      if (entry.unredacted !== true) continue
      if (protectedPlaintexts.has(entry.plaintext)) continue
      if (nonExemptCatalogPlaintexts.has(entry.plaintext)) continue
      names.push(entry.name)
    }
    return names
  }

  /**
   * Returns committed literals that must be removed before content can cross into a model.
   * Only entries activated by an exact resolver or trusted provenance boundary participate;
   * configured-but-unused catalog values remain inert. Temporary work in another call is
   * intentionally excluded until that call commits a result.
   */
  getModelEgressSnapshot(): ResolvedSecretModelEgressSnapshot {
    if (this.isPermanentlyIncomplete()) return { complete: false }

    const modelEntries = [...this.activeEntries.values()]
    const legacyAliasEntries = modelEntries
      .filter((entry) => entry.name.length > 0)
      .map(
        (entry): ActiveSecretEntry => ({
          ...entry,
          plaintext: createLegacyRuntimeAlias(entry.name),
        })
      )
    const matches = this.withJsonStringEncodedMatches(
      this.buildMatches([...modelEntries, ...legacyAliasEntries])
    )
    if (getResolvedSecretMatcherCapacityFailure(matches.map((match) => match.plaintext))) {
      return { complete: false }
    }
    return { complete: true, matches }
  }

  /** Monotonic revision used to reuse model-egress matchers until registry state changes. */
  getModelEgressRevision(): number {
    return this.modelEgressRevision
  }

  private withJsonStringEncodedMatches(
    matches: readonly ResolvedSecretTraceMatch[]
  ): readonly ResolvedSecretTraceMatch[] {
    const replacementByPlaintext = new Map<string, string>()
    const addMatch = (plaintext: string, replacement: string): void => {
      if (!plaintext) return
      const existing = replacementByPlaintext.get(plaintext)
      if (existing === undefined) {
        replacementByPlaintext.set(plaintext, replacement)
      } else if (existing !== replacement) {
        replacementByPlaintext.set(plaintext, ANONYMOUS_SECRET_TRACE_REPLACEMENT)
      }
    }

    for (const match of matches) {
      addMatch(match.plaintext, match.replacement)
      const encodedPlaintext = JSON.stringify(match.plaintext).slice(1, -1)
      const encodedReplacement = JSON.stringify(match.replacement).slice(1, -1)
      addMatch(encodedPlaintext, encodedReplacement)
    }

    return [...replacementByPlaintext]
      .map(([plaintext, replacement]) => ({ plaintext, replacement }))
      .sort(
        (left, right) =>
          right.plaintext.length - left.plaintext.length ||
          compareStrings(left.plaintext, right.plaintext) ||
          compareStrings(left.replacement, right.replacement)
      )
  }

  /**
   * Whether one active entry is exempt from redaction. Derived through the catalog at decision
   * time rather than trusted off the entry, so an imported duplicate of a flagged secret is
   * exempt only when byte-identical to the run's own catalog value, and replace-on-mismatch
   * churn in {@link addActiveEntry} cannot change the answer.
   */
  private isUnredactedEntry(entry: ActiveSecretEntry): boolean {
    if (entry.anonymous || entry.name.length === 0) return false
    const catalogEntry = this.catalog.get(entry.name)
    return catalogEntry?.unredacted === true && catalogEntry.plaintext === entry.plaintext
  }

  /**
   * Plaintexts that must stay redacted regardless of any exemption: every active entry that is
   * not itself exempt, plus everything a fork's parent was protecting. Computed over the FULL
   * active set, never a caller's selected subset — the bytes leaving a surface are the same no
   * matter which selection vouched for them.
   */
  private collectProtectedPlaintexts(): Set<string> {
    const protectedPlaintexts = new Set(this.inheritedProtectedPlaintexts)
    for (const entry of this.activeEntries.values()) {
      if (!this.isUnredactedEntry(entry)) protectedPlaintexts.add(entry.plaintext)
    }
    return protectedPlaintexts
  }

  private buildMatches(entries: Iterable<ActiveSecretEntry>): readonly ResolvedSecretTraceMatch[] {
    const candidatesByPlaintext = new Map<string, ActiveSecretEntry[]>()
    for (const entry of entries) {
      /**
       * Dropped here too, not only inside the matcher, so a literal that will never be substituted
       * also never counts toward the matcher capacity bound or appears to a snapshot reader as
       * something this registry protects.
       */
      if (entry.plaintext.length === 0 || isNonIdentifyingSecretLiteral(entry.plaintext)) continue
      const candidates = candidatesByPlaintext.get(entry.plaintext) ?? []
      candidates.push(entry)
      candidatesByPlaintext.set(entry.plaintext, candidates)
    }

    /**
     * A plaintext leaves the match set only when every owner of those bytes is exempt AND no
     * fork parent was protecting them — any non-exempt owner (a personal secret, an anonymous
     * token) keeps the substitution, failing toward redaction on collision.
     */
    for (const [plaintext, candidates] of candidatesByPlaintext) {
      if (this.inheritedProtectedPlaintexts.has(plaintext)) continue
      if (candidates.every((candidate) => this.isUnredactedEntry(candidate))) {
        candidatesByPlaintext.delete(plaintext)
      }
    }

    const matches = [...candidatesByPlaintext.keys()].map((plaintext) => {
      const candidates = candidatesByPlaintext.get(plaintext) ?? []
      const anonymous = candidates.some((candidate) => candidate.anonymous)
      const names = new Set(
        candidates.filter((candidate) => !candidate.anonymous).map((candidate) => candidate.name)
      )
      const replacement =
        anonymous || names.size !== 1
          ? ANONYMOUS_SECRET_TRACE_REPLACEMENT
          : `{{${names.values().next().value}}}`

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
    return this.complete && this.incompleteInputPaths.size === 0 && this.pendingActivations === 0
  }

  /**
   * Reports why this registry is incomplete, for a caller that is about to refuse a projection.
   *
   * Returns undefined while the registry can still vouch, so a caller cannot accidentally report a
   * cause for a projection that succeeded.
   */
  getIncompletenessDiagnostics(): ResolvedSecretIncompletenessDiagnostics | undefined {
    if (!this.isPermanentlyIncomplete()) return undefined
    return {
      reasons: [...this.incompletenessReasons],
      origins: [...this.incompletenessOrigins],
      incompleteInputPathCount: this.incompleteInputPaths.size,
      activeEntryCount: this.activeEntries.size,
      ...(this.scope?.workspaceId ? { scopeWorkspaceId: this.scope.workspaceId } : {}),
      ...(this.incompletenessDetail ? { detail: this.incompletenessDetail } : {}),
    }
  }

  /** Retains a reason for later refusal reporting; the reason type bounds the set at its size. */
  private recordIncompletenessReason(reason: ResolvedSecretIncompletenessReason): void {
    this.incompletenessReasons.add(reason)
  }

  /** Retains the importing caller, keeping the earliest once the bound is reached. */
  private recordIncompletenessOrigin(origin: string): void {
    if (this.incompletenessOrigins.size >= MAX_RETAINED_ORIGINS) return
    this.incompletenessOrigins.add(origin)
  }

  /**
   * Carries a source registry's reasons into a fork or merge target, so a refusal downstream still
   * names the guard that originally tripped rather than only the propagation that reached it.
   */
  private inheritIncompletenessReasonsFrom(source: ResolvedSecretTraceRegistry): void {
    for (const reason of source.incompletenessReasons) this.recordIncompletenessReason(reason)
    for (const origin of source.incompletenessOrigins) this.recordIncompletenessOrigin(origin)
    this.incompletenessDetail ??= source.incompletenessDetail
  }

  isPermanentlyIncomplete(): boolean {
    return !this.complete || this.incompleteInputPaths.size > 0
  }

  /**
   * `reason` is required. It defaulted to `'unspecified'`, and every caller that took the default
   * produced a latch naming no guard — which is exactly the state that made a production incident
   * untraceable for a day. Making omission a compile error is what keeps the reason set honest as
   * new guards are added; a caller that genuinely has nothing to say passes `'unspecified'` on
   * purpose, where a reviewer can see it.
   */
  markIncomplete(
    reason: ResolvedSecretIncompletenessReason,
    context: MarkIncompleteContext = {}
  ): void {
    if (context.source) this.inheritIncompletenessReasonsFrom(context.source)
    this.recordIncompletenessReason(reason)
    if (context.origin) this.recordIncompletenessOrigin(context.origin)
    this.incompletenessDetail ??= context.detail
    if (!this.complete) return
    this.complete = false
    this.modelEgressRevision += 1
    if (this.staged) return
    reportIncompleteness('Resolved secret registry marked incomplete', reason, {
      /** Spread first so a caller's detail can never shadow the fields every line is read by. */
      ...(context.detail ?? {}),
      ...(context.origin ? { origin: context.origin } : {}),
      scopeWorkspaceId: this.scope?.workspaceId,
      activeEntryCount: this.activeEntries.size,
      incompleteInputPathCount: this.incompleteInputPaths.size,
    })
  }

  /**
   * Prevents durable provenance export while a runtime boundary is still establishing what its
   * settled output contains. Model projection reads committed active entries directly, so a
   * sibling call's temporary guard cannot block unrelated work. The completion callback is
   * idempotent so every exit path can safely release it.
   */
  beginPendingActivation(): () => void {
    this.pendingActivations += 1
    let completed = false

    return () => {
      if (completed) return
      completed = true
      this.pendingActivations = Math.max(0, this.pendingActivations - 1)
    }
  }

  /** Serializes only encrypted active values; plaintext never enters execution state. */
  exportProvenance(): ResolvedSecretTraceProvenanceV1 {
    const complete = this.isComplete()
    const entries = complete ? this.buildProvenanceEntries([...this.activeEntries.values()]) : []

    return {
      version: 1,
      complete,
      entries,
      ...(this.scope ? { scope: cloneProvenanceScope(this.scope) } : {}),
    }
  }

  /**
   * Captures a durable checkpoint after all completed mutations while ignoring temporary
   * activation guards. In-flight calls have not committed outputs to the snapshot, so persisting
   * their guard as permanent incompleteness would incorrectly poison a later resume.
   */
  exportCheckpointProvenance(): ResolvedSecretTraceProvenanceV1 {
    const complete = this.complete && this.incompleteInputPaths.size === 0
    const entries = complete ? this.buildProvenanceEntries([...this.activeEntries.values()]) : []

    return {
      version: 1,
      complete,
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
    if (!this.isComplete()) return this.incompleteProvenance()

    return this.exportProvenanceForValueWithPreparedFilter(
      value,
      this.getPreparedActiveProvenanceFilter(),
      options
    )
  }

  /**
   * Filters committed active provenance for an outbound value without treating a sibling call's
   * temporary activation guard as missing data. In-flight work has not contributed to `value`, so
   * it must not poison this independently settled transport boundary.
   */
  exportCommittedProvenanceForValue(
    value: unknown,
    options: ExportResolvedSecretTraceProvenanceForValueOptions = {}
  ): ResolvedSecretTraceProvenanceV1 {
    if (this.isPermanentlyIncomplete()) return this.incompleteProvenance()

    return this.exportProvenanceForValueWithPreparedFilter(
      value,
      this.getPreparedActiveProvenanceFilter(),
      options
    )
  }

  private exportProvenanceForValueFromEntries(
    value: unknown,
    candidateEntries: Iterable<ActiveSecretEntry>,
    options: ExportResolvedSecretTraceProvenanceForValueOptions
  ): ResolvedSecretTraceProvenanceV1 {
    return this.exportProvenanceForValuesFromEntries([value], candidateEntries, options)
  }

  private exportProvenanceForValuesFromEntries(
    values: Iterable<unknown>,
    candidateEntries: Iterable<ActiveSecretEntry>,
    options: ExportResolvedSecretTraceProvenanceForValueOptions
  ): ResolvedSecretTraceProvenanceV1 {
    return this.exportProvenanceForValuesWithPreparedFilter(
      values,
      this.prepareProvenanceFilter(candidateEntries),
      options
    )
  }

  private getPreparedActiveProvenanceFilter(): PreparedProvenanceFilterResult {
    if (this.activeProvenanceFilterCache?.revision === this.modelEgressRevision) {
      return this.activeProvenanceFilterCache.result
    }

    const result = this.prepareProvenanceFilter(this.activeEntries.values())
    this.activeProvenanceFilterCache = { revision: this.modelEgressRevision, result }
    return result
  }

  private prepareProvenanceFilter(
    sourceEntries: Iterable<ActiveSecretEntry>
  ): PreparedProvenanceFilterResult {
    const candidatesByPlaintext = new Map<string, ActiveSecretEntry[]>()
    const sortedCandidateEntries = [...sourceEntries].sort(
      (left, right) =>
        compareStrings(left.name, right.name) ||
        compareStrings(left.encryptedValue, right.encryptedValue)
    )
    for (const entry of sortedCandidateEntries) {
      /**
       * Excluded from scan literals as well as from the matcher, so such a value is never recorded
       * into durable provenance as something a later read must redact. A named entry still joins
       * the alias loop below — `__var_NAME` identifies the variable even when its value does not.
       */
      if (entry.plaintext.length === 0 || isNonIdentifyingSecretLiteral(entry.plaintext)) continue
      const candidates = candidatesByPlaintext.get(entry.plaintext) ?? []
      const entryKey = activeEntryKey(entry)
      if (!candidates.some((candidate) => activeEntryKey(candidate) === entryKey)) {
        candidates.push(entry)
        candidatesByPlaintext.set(entry.plaintext, candidates)
      }
    }

    const candidatesByScanLiteral = new Map<string, ActiveSecretEntry[]>()
    const candidateEntries = new Map<string, ActiveSecretEntry>()
    const addScanLiteral = (literal: string, entry: ActiveSecretEntry): void => {
      if (literal.length === 0) return
      const candidates = candidatesByScanLiteral.get(literal) ?? []
      const entryKey = activeEntryKey(entry)
      if (!candidates.some((candidate) => activeEntryKey(candidate) === entryKey)) {
        candidates.push(entry)
        candidatesByScanLiteral.set(literal, candidates)
      }
      candidateEntries.set(entryKey, entry)
    }
    for (const candidates of candidatesByPlaintext.values()) {
      for (const entry of candidates) {
        addScanLiteral(entry.plaintext, entry)
        addScanLiteral(JSON.stringify(entry.plaintext).slice(1, -1), entry)
      }
    }

    const candidatesByAlias = new Map<string, ActiveSecretEntry[]>()
    for (const entry of sortedCandidateEntries) {
      if (!entry.name) continue
      const alias = createLegacyRuntimeAlias(entry.name)
      const candidates = candidatesByAlias.get(alias) ?? []
      const entryKey = activeEntryKey(entry)
      if (!candidates.some((candidate) => activeEntryKey(candidate) === entryKey)) {
        candidates.push(entry)
        candidatesByAlias.set(alias, candidates)
      }
      candidateEntries.set(entryKey, entry)
    }

    let matcher: ResolvedSecretMatcher | undefined
    try {
      matcher = createResolvedSecretMatcher(
        [...candidatesByScanLiteral.keys()].map((plaintext) => ({ plaintext, replacement: '' }))
      )
    } catch (error) {
      logger.error('Provenance filter matcher could not be built', {
        error: getErrorMessage(error, 'Unknown error'),
        candidateCount: candidatesByScanLiteral.size,
      })
      return { complete: false, candidateEntries }
    }

    return {
      complete: true,
      filter: {
        candidatesByScanLiteral,
        candidatesByAlias,
        candidateEntries,
        ...(matcher ? { matcher } : {}),
      },
    }
  }

  /** Builds the envelope for one selected entry set; only this registry's own state can void it. */
  private provenanceForSelectedEntries(
    entries: ReadonlyMap<string, ActiveSecretEntry>,
    options: ExportResolvedSecretTraceProvenanceForValueOptions
  ): ResolvedSecretTraceProvenanceV1 {
    const complete = !this.isPermanentlyIncomplete()
    return {
      version: 1,
      complete,
      entries: complete
        ? this.buildProvenanceEntries([...entries.values()], options.anonymous)
        : [],
      ...(this.scope ? { scope: cloneProvenanceScope(this.scope) } : {}),
    }
  }

  /**
   * Answers a value the bounded scan could not read in full by keeping every candidate entry.
   *
   * Narrowing exists to stop content that provably carries no secret from being over-redacted; it
   * is not what makes an envelope trustworthy. The candidates are already the trusted answer to
   * "which secrets could this value carry", so an unreadable value — an offloaded large-value ref
   * the scan cannot see through, a payload past the traversal bound, a hostile accessor — degrades
   * to no narrowing rather than to unknown provenance.
   *
   * Reporting unknown here is what let a size threshold behave like a permanent fault: the flag
   * travels onto the producing block's state, and every model boundary that later consumes that
   * output refuses, with nothing telling the author the cause was payload volume rather than a
   * secret. Over-approximating costs extra redaction; it can never under-redact.
   */
  private unnarrowedProvenance(
    candidateEntries: ReadonlyMap<string, ActiveSecretEntry>,
    options: ExportResolvedSecretTraceProvenanceForValueOptions
  ): ResolvedSecretTraceProvenanceV1 {
    return this.provenanceForSelectedEntries(candidateEntries, options)
  }

  private exportProvenanceForValueWithPreparedFilter(
    value: unknown,
    prepared: PreparedProvenanceFilterResult,
    options: ExportResolvedSecretTraceProvenanceForValueOptions
  ): ResolvedSecretTraceProvenanceV1 {
    return this.exportProvenanceForValuesWithPreparedFilter([value], prepared, options)
  }

  private exportProvenanceForValuesWithPreparedFilter(
    values: Iterable<unknown>,
    prepared: PreparedProvenanceFilterResult,
    options: ExportResolvedSecretTraceProvenanceForValueOptions
  ): ResolvedSecretTraceProvenanceV1 {
    if (!prepared.complete) {
      return this.unnarrowedProvenance(prepared.candidateEntries, options)
    }

    const { candidatesByScanLiteral, candidatesByAlias, candidateEntries, matcher } =
      prepared.filter
    const matchedEntries = new Map<string, ActiveSecretEntry>()
    const pendingValues: unknown[] = []
    try {
      for (const value of values) {
        if (pendingValues.length >= MAX_PROVENANCE_FILTER_NODES) {
          return this.unnarrowedProvenance(candidateEntries, options)
        }
        pendingValues.push(value)
      }
    } catch {
      return this.unnarrowedProvenance(candidateEntries, options)
    }
    const visited = new WeakSet<object>()
    let scannedNodes = 0
    let scannedCharacters = 0
    let matchEvents = 0
    let enumeratedProperties = 0
    let scanComplete = true
    const matchedAliases = new Set<string>()

    const scanString = (candidate: string): boolean => {
      scannedCharacters += candidate.length
      if (scannedCharacters > MAX_PROVENANCE_FILTER_CHARACTERS) return false

      try {
        if (matcher) {
          matchEvents += scanResolvedSecretString(
            candidate,
            matcher,
            (scanLiteral) => {
              for (const entry of candidatesByScanLiteral.get(scanLiteral) ?? []) {
                matchedEntries.set(activeEntryKey(entry), entry)
              }
            },
            MAX_PROVENANCE_FILTER_MATCH_EVENTS - matchEvents
          )
        }
        for (const match of candidate.matchAll(LEGACY_RUNTIME_ALIAS_PATTERN)) {
          const alias = match[0]
          const candidates = candidatesByAlias.get(alias)
          if (!candidates || matchedAliases.has(alias)) continue
          matchedAliases.add(alias)
          matchEvents++
          if (matchEvents > MAX_PROVENANCE_FILTER_MATCH_EVENTS) return false
          for (const entry of candidates) {
            matchedEntries.set(activeEntryKey(entry), entry)
          }
        }
      } catch {
        return false
      }
      return true
    }

    const scanProperty = (key: string, descriptor: PropertyDescriptor): boolean => {
      if (scannedNodes + pendingValues.length >= MAX_PROVENANCE_FILTER_NODES) return false
      scannedNodes++
      if (!scanString(key)) return false
      if (matchedEntries.size >= candidateEntries.size) return true

      if ('value' in descriptor) {
        if (scannedNodes + pendingValues.length >= MAX_PROVENANCE_FILTER_NODES) return false
        pendingValues.push(descriptor.value)
      } else if (descriptor.enumerable) {
        return false
      }
      return true
    }

    while (pendingValues.length > 0 && matchedEntries.size < candidateEntries.size) {
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
          if (matchedEntries.size >= candidateEntries.size) break
        }
        if (!scanComplete || matchedEntries.size >= candidateEntries.size) break

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
          if (matchedEntries.size >= candidateEntries.size) break
        }
        if (!scanComplete) break
      } catch {
        scanComplete = false
        break
      }
    }

    return scanComplete
      ? this.provenanceForSelectedEntries(matchedEntries, options)
      : this.unnarrowedProvenance(candidateEntries, options)
  }

  private collectInputPathEntryKeys(paths: readonly ResolvedSecretInputPath[]): Set<string> {
    const selected = new Set<string>()
    for (const state of this.resolvedInputPaths.values()) {
      if (!paths.some((path) => isInputPathWithin(state.path, path))) continue
      for (const entryKey of state.entryKeys) selected.add(entryKey)
    }
    return selected
  }

  private incompleteProvenance(): ResolvedSecretTraceProvenanceV1 {
    return {
      version: 1,
      complete: false,
      entries: [],
      ...(this.scope ? { scope: cloneProvenanceScope(this.scope) } : {}),
    }
  }

  private copyResolvedInputPathsTo(
    target: ResolvedSecretTraceRegistry,
    roots?: readonly ResolvedSecretInputPath[]
  ): void {
    for (const [key, state] of this.resolvedInputPaths) {
      if (roots && !roots.some((root) => isInputPathWithin(state.path, root))) continue
      const targetState = target.resolvedInputPaths.get(key) ?? {
        path: [...state.path],
        entryKeys: new Set<string>(),
      }
      for (const entryKey of state.entryKeys) targetState.entryKeys.add(entryKey)
      if (state.rawValue !== undefined && state.projectedValue !== undefined) {
        targetState.rawValue = state.rawValue
        targetState.projectedValue = state.projectedValue
      }
      target.resolvedInputPaths.set(key, targetState)
    }
  }

  private hasIncompleteInputPathOverlapping(paths: readonly ResolvedSecretInputPath[]): boolean {
    return [...this.incompleteInputPaths.values()].some((incompletePath) =>
      paths.some((path) => inputPathsOverlap(incompletePath, path))
    )
  }

  private markInputPathIncomplete(
    path: ResolvedSecretInputPath | undefined,
    reason: ResolvedSecretIncompletenessReason,
    origin?: string
  ): void {
    if (!path || path.length === 0) {
      this.markIncomplete(reason, { origin })
      return
    }
    this.recordIncompletenessReason(reason)
    if (origin) this.recordIncompletenessOrigin(origin)
    const key = inputPathKey(path)
    if (this.incompleteInputPaths.has(key)) return
    this.incompleteInputPaths.set(key, [...path])
    this.modelEgressRevision += 1
    if (this.staged) return
    reportIncompleteness('Resolved secret input path marked incomplete', reason, {
      ...(origin ? { origin } : {}),
      inputPath: path.join('.'),
      scopeWorkspaceId: this.scope?.workspaceId,
      activeEntryCount: this.activeEntries.size,
    })
  }

  private copyIncompleteInputPathsTo(
    target: ResolvedSecretTraceRegistry,
    roots?: readonly ResolvedSecretInputPath[]
  ): void {
    let copied = false
    for (const [key, path] of this.incompleteInputPaths) {
      if (roots && !roots.some((root) => inputPathsOverlap(path, root))) continue
      target.incompleteInputPaths.set(key, [...path])
      copied = true
    }
    if (copied) target.inheritIncompletenessReasonsFrom(this)
  }

  private addActiveEntry(entry: ActiveSecretEntry, options: { propagated?: boolean } = {}): void {
    const key = activeEntryKey(entry)
    const existing = this.activeEntries.get(key)
    if (existing) {
      if (options.propagated) this.propagatedEntryKeys.add(key)
      if (
        existing.name === entry.name &&
        existing.plaintext === entry.plaintext &&
        existing.encryptedValue === entry.encryptedValue &&
        existing.anonymous === entry.anonymous
      ) {
        return
      }
      this.activeEntries.set(key, entry)
      this.modelEgressRevision += 1
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
      this.markIncomplete('provenance-capacity-exceeded')
      return
    }
    this.activeEntries.set(key, entry)
    if (options.propagated) this.propagatedEntryKeys.add(key)
    this.activeProvenanceEntryBytes += separatorBytes + entryBytes
    this.modelEgressRevision += 1
  }

  private addCatalogEntry(entry: ResolvedSecretTraceCatalogEntry): boolean {
    const existing = this.catalog.get(entry.name)
    const nextCatalogBytes =
      this.catalogBytes -
      (existing ? catalogEntryByteSize(existing) : 0) +
      catalogEntryByteSize(entry)
    const nextCatalogSize = this.catalog.size + (existing ? 0 : 1)
    if (nextCatalogSize > MAX_TRACE_CATALOG_ENTRIES || nextCatalogBytes > MAX_TRACE_CATALOG_BYTES) {
      return false
    }

    this.catalog.set(entry.name, { ...entry })
    this.catalogBytes = nextCatalogBytes
    this.modelEgressRevision += 1
    return true
  }

  private buildProvenanceEntries(
    activeEntries: ActiveSecretEntry[],
    forceAnonymous = false
  ): ResolvedSecretTraceProvenanceEntryV1[] {
    /**
     * Exempt entries are omitted from every envelope — that is what lets per-span display
     * projection show the plaintext, durable sidecars leave files unlocked, and opaque
     * model-input validation accept the value. EXCEPT under forced anonymity: that envelope
     * crosses into a scope where the flagging workspace's decision carries no authority (the
     * custom-block crossing runs the child in the source workflow's workspace), so exempt
     * entries are kept — anonymized — rather than dropped. The protected set is computed over
     * the full active set, not the caller's selection, so a colliding non-exempt owner keeps
     * the entry no matter which paths vouched for the value.
     */
    const protectedPlaintexts = forceAnonymous ? undefined : this.collectProtectedPlaintexts()
    return activeEntries
      .filter(
        (entry) =>
          protectedPlaintexts === undefined ||
          protectedPlaintexts.has(entry.plaintext) ||
          !this.isUnredactedEntry(entry)
      )
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
  } else if (
    options.requireRestoredProvenance &&
    options.restoreTrusted === true &&
    options.restoredCheckpointVersion !== undefined
  ) {
    registry.markIncomplete('restored-checkpoint-unavailable')
  }

  return registry
}

/** Creates a scoped fail-closed registry when trusted catalog provenance is unavailable. */
export function createIncompleteResolvedSecretTraceRegistry(
  scope?: ResolvedSecretTraceScopeV1
): ResolvedSecretTraceRegistry {
  const registry = new ResolvedSecretTraceRegistry([], scope)
  registry.markIncomplete('constructed-incomplete')
  return registry
}
