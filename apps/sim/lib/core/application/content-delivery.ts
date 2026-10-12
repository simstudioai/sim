import { AsyncLocalStorage } from 'node:async_hooks'
import type { Principal } from '@sim/auth/principal'
import type { ApplicationOperation } from '@/lib/core/application/operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DurableSecretProvenance } from '@/lib/execution/durable-secret-provenance'

/**
 * The secret provenance of one stored item: `exact` names every secret its content can hold,
 * `unrecorded` is a writer that recorded nothing (audited, otherwise ordinary input), and `unknown`
 * is taint or a stale binding, which no policy relaxes.
 */
export type ContentProvenance = DurableSecretProvenance | { status: 'unrecorded' }

export type ContentSourceKind =
  | 'workspace-file'
  | 'execution-file'
  | 'knowledge-document'
  | 'knowledge-chunk'
  | 'table-row'

/**
 * How an item's content leaves the use case. `complete` is text in which any of its secrets may
 * appear; `derived` is text built from part of it, so only secrets occurring in `value` count;
 * `opaque` is bytes no text redaction reaches — binary, base64, archives, images, public links.
 */
export type ContentView = 'complete' | 'opaque' | { derived: unknown }

/** One stored item whose content, or content derived from it, a use case is about to return. */
export interface ContentSource {
  kind: ContentSourceKind
  /** Canonical id, for attribution and per-item exclusion only. */
  id: string
  provenance: ContentProvenance
  view: ContentView
}

/**
 * Decides, per item, whether content may leave through the surface that installed it. A gate never
 * throws for a refusal: refusing one item must not cost the call the items it admits.
 */
export interface ContentDeliveryGate {
  admit(sources: readonly ContentSource[]): Promise<readonly boolean[]>
}

/**
 * Whether a declared operation's result can carry content derived from a provenance-bearing store
 * (workspace files and their versions, execution files, knowledge documents and chunks, table
 * rows): bytes, text, excerpts, cells, previews, base64, archives, public links to such content, or
 * a match oracle over it. `none` is spelled out, as `capability` is, so an operation Chat can reach
 * cannot reach production without someone deciding.
 */
export type ContentDeliveryDeclaration = 'sourced' | 'none'

/** Accounting for one dispatched request or one use-case execution. */
interface ContentLedger {
  parent?: ContentLedger
  /** The declaration of the operation this ledger runs, when it runs one. */
  declaration?: ContentDeliveryDeclaration
  /** Chat was admitted to a `sourced` operation while this ledger was open. */
  sourcedOperationAdmitted: boolean
  /** A use case accounted for the sources it returns, even when it returned none. */
  accounted: boolean
  /** Provenance of every admitted item, for a surface that persists the delivered bytes. */
  admitted: ContentProvenance[]
  /** A committed write's returned item was refused; the operation answers with a refusal. */
  withheldAfterWrite?: ContentSourceKind
  /** A committed write's gate failed; the operation completes, then answers with this error. */
  failedAfterWrite?: unknown
  /** The gate itself failed while this ledger was open, whatever the route then answered. */
  gateFailure?: unknown
}

const gates = new AsyncLocalStorage<ContentDeliveryGate>()
const ledgers = new AsyncLocalStorage<ContentLedger>()

const MODEL_UNSAFE_CONTENT_MESSAGES: Record<ContentSourceKind, string> = {
  'workspace-file': 'File cannot be sent to a model because its secret provenance is unavailable',
  'execution-file':
    'Run file cannot be sent to a model because its secret provenance is unavailable',
  'knowledge-document':
    'Document cannot be sent to a model because its secret provenance is unavailable',
  'knowledge-chunk': 'Chunk cannot be sent to a model because its secret provenance is unavailable',
  'table-row': 'Row cannot be sent to a model because its secret provenance is unavailable',
}

/**
 * A gate refused an item. A `403` like any refusal, but its own class, so a caller assembling many
 * items can leave this one out without mistaking a permission denial for it.
 */
export class ContentRefusedError extends OrchestrationError {
  /** `afterWrite` names a refusal of a write's returned content once the write has committed. */
  constructor(kind: ContentSourceKind, options: { afterWrite?: boolean } = {}) {
    super(
      'forbidden',
      options.afterWrite
        ? `The change was saved. ${MODEL_UNSAFE_CONTENT_MESSAGES[kind]}, so the result is not shown; do not retry the change.`
        : MODEL_UNSAFE_CONTENT_MESSAGES[kind]
    )
    this.name = 'ContentRefusedError'
  }
}

/** Chat reached stored content with no gate to classify it. */
export class ContentDeliveryUnobservedError extends Error {
  constructor() {
    super('Content provenance is unavailable for this read. Retry the read.')
    this.name = 'ContentDeliveryUnobservedError'
  }
}

/** A `sourced` operation completed for Chat without accounting for the content it returned. */
export class ContentDeliveryUnaccountedError extends Error {
  constructor(operationId: string) {
    super(`Operation ${operationId} returned content to Chat without classifying it`)
    this.name = 'ContentDeliveryUnaccountedError'
  }
}

/** Content was classified for Chat inside an operation declared to return none. */
class ContentDeliveryUndeclaredError extends Error {
  constructor() {
    super('Content was delivered to Chat by an operation declared to return none')
    this.name = 'ContentDeliveryUndeclaredError'
  }
}

/** Chat's own principals: the in-workspace delegation and the organization chat delegation. */
export function isCopilotPrincipal(principal: Principal): boolean {
  return (
    (principal.kind === 'delegated' || principal.kind === 'organization_delegated') &&
    principal.serviceId === 'copilot'
  )
}

/** Installs the gate every item reported inside `execute` is decided by; the innermost gate wins. */
export function observeContentDelivery<T>(gate: ContentDeliveryGate, execute: () => T): T {
  return gates.run(gate, execute)
}

/** Admits every item: see {@link observeContentOutsideModel}. */
const OUTSIDE_MODEL_GATE: ContentDeliveryGate = {
  async admit(sources) {
    return sources.map(() => true)
  },
}

/**
 * Reads, for Chat, content that never reaches its model: input to a stored artifact whose
 * classification the caller derives from every source it read (a transcoded media file), or the
 * user's own view of a file being edited. Items read inside `execute` are admitted unclassified,
 * so a tainted source still yields a derived file that carries its taint. Each use names why.
 */
export function observeContentOutsideModel<T>(execute: () => T): T {
  return gates.run(OUTSIDE_MODEL_GATE, execute)
}

/**
 * Whether this call must classify what it returns: Chat's own principals, under the gate of the
 * surface they read through. Chat with no gate is refused here, before anything loads, rather
 * than handed content no surface classified. Use cases read provenance only when this is true, so
 * a caller no gate observes — the UI, API keys, MCP, the executor, and app tools Chat runs under an
 * executor identity, whose results carry their own provenance metadata — issues no extra query
 * and sees no change.
 */
export function mustClassifyContent(principal: Principal): boolean {
  if (!isCopilotPrincipal(principal)) return false
  if (!gates.getStore()) throw new ContentDeliveryUnobservedError()
  return true
}

/** The per-item verdicts for one call to {@link admitContent}. */
export class ContentAdmission {
  private readonly verdicts: ReadonlyMap<ContentSource, boolean>

  constructor(sources: readonly ContentSource[], verdicts: readonly boolean[]) {
    this.verdicts = new Map(sources.map((source, index) => [source, verdicts[index] === true]))
  }

  admits(source: ContentSource): boolean {
    return this.verdicts.get(source) === true
  }

  get refused(): ContentSource[] {
    return [...this.verdicts].filter(([, admitted]) => !admitted).map(([source]) => source)
  }
}

function markAccounted(): void {
  for (let ledger = ledgers.getStore(); ledger; ledger = ledger.parent) ledger.accounted = true
}

/**
 * Classifies every item a use case is about to return, before its content loads. Call it once per
 * result, with every contributing item, including an empty list: that call is the use case's
 * promise to the operation's `sourced` declaration that nothing else in the result is sourced.
 *
 * Chat with no gate installed is refused (fail closed); every other caller is admitted unread. An
 * empty list loads nothing, so it only accounts.
 */
export async function admitContent(
  principal: Principal,
  sources: readonly ContentSource[]
): Promise<ContentAdmission> {
  if (
    sources.length > 0 &&
    isCopilotPrincipal(principal) &&
    ledgers.getStore()?.declaration === 'none'
  ) {
    throw new ContentDeliveryUndeclaredError()
  }
  markAccounted()
  if (sources.length === 0 || !mustClassifyContent(principal)) {
    return new ContentAdmission(
      sources,
      sources.map(() => true)
    )
  }
  const gate = gates.getStore()
  if (!gate) throw new ContentDeliveryUnobservedError()
  const ledger = ledgers.getStore()
  let verdicts: readonly boolean[]
  try {
    verdicts = await gate.admit(sources)
  } catch (error) {
    /** Kept for the transport: a route maps the error to its own response and hides the cause. */
    for (let current: ContentLedger | undefined = ledger; current; current = current.parent) {
      current.gateFailure ??= error
    }
    throw error
  }
  if (ledger) {
    sources.forEach((source, index) => {
      if (verdicts[index]) {
        for (let current: ContentLedger | undefined = ledger; current; current = current.parent) {
          current.admitted.push(source.provenance)
        }
      }
    })
  }
  return new ContentAdmission(sources, verdicts)
}

/**
 * Admits what a write returns after it committed. A refused item does not end the call here, so
 * the operation still records its audit and signals its change; it then answers with a refusal
 * naming the saved change instead of a result carrying content its gate refused.
 */
export async function admitWrittenContent(
  principal: Principal,
  sources: readonly ContentSource[]
): Promise<ContentAdmission> {
  let admission: ContentAdmission
  try {
    admission = await admitContent(principal, sources)
  } catch (error) {
    /**
     * A gate that cannot decide (its record could not be written) must not undo the write's
     * audit and effects either: every item is withheld, and the operation answers with the error.
     */
    const ledger = ledgers.getStore()
    if (!ledger) throw error
    for (let open: ContentLedger | undefined = ledger; open; open = open.parent) {
      open.failedAfterWrite ??= error
    }
    return new ContentAdmission(
      sources,
      sources.map(() => false)
    )
  }
  const refused = admission.refused[0]
  if (refused) {
    for (let ledger = ledgers.getStore(); ledger; ledger = ledger.parent) {
      ledger.withheldAfterWrite ??= refused.kind
    }
  }
  return admission
}

/**
 * Admits each of many items on its own and returns the admitted ones, in order. `classify` maps
 * the items to their sources, one per item and batched; it runs only when this call must
 * classify, so any other caller pays no provenance read. An item it cannot vouch for is `unknown`.
 */
export async function admitEach<T>(
  principal: Principal,
  items: readonly T[],
  classify: (items: readonly T[]) => Promise<readonly ContentSource[]>,
  options: { written?: boolean } = {}
): Promise<T[]> {
  if (items.length === 0 || !mustClassifyContent(principal)) {
    await admitContent(principal, [])
    return [...items]
  }
  const sources = await classify(items)
  const admission = await (options.written ? admitWrittenContent : admitContent)(principal, sources)
  return items.filter((_, index) => admission.admits(sources[index]))
}

/**
 * The single-item form: a refused item ends the call with a `403` before its content loads, with a
 * constant message that names no content.
 */
export async function requireAdmittedContent(
  principal: Principal,
  source: ContentSource
): Promise<void> {
  const admission = await admitContent(principal, [source])
  if (!admission.admits(source)) throw new ContentRefusedError(source.kind)
}

/** What one dispatched request delivered, as the transport that dispatched it needs to know. */
export interface ContentDeliveryRecord<T> {
  result: T
  /** Chat ran a `sourced` operation whose use case never accounted for its content. */
  unaccounted: boolean
  /** The gate failed to decide during the request; see {@link ContentLedger.gateFailure}. */
  gateFailure?: unknown
  /** Provenance of every admitted item, in admission order. */
  admitted: readonly ContentProvenance[]
}

/**
 * Dispatches one request under its own ledger. A transport refuses a successful response whose
 * record is `unaccounted`, whatever the HTTP method, so a route that forgot to classify its content
 * fails closed instead of passing it through.
 */
export async function trackContentDelivery<T>(
  execute: () => Promise<T>
): Promise<ContentDeliveryRecord<T>> {
  const ledger: ContentLedger = {
    parent: ledgers.getStore(),
    sourcedOperationAdmitted: false,
    accounted: false,
    admitted: [],
  }
  const result = await ledgers.run(ledger, execute)
  return {
    result,
    unaccounted: ledger.sourcedOperationAdmitted && !ledger.accounted,
    admitted: ledger.admitted,
    ...(ledger.gateFailure === undefined ? {} : { gateFailure: ledger.gateFailure }),
  }
}

/** Route admission records that Chat was admitted to an operation, in the request's ledger. */
export function noteContentDeliveryOperation(
  operation: ApplicationOperation,
  principal: Principal
): void {
  if (!isCopilotPrincipal(principal) || operation.contentDelivery !== 'sourced') return
  for (let ledger = ledgers.getStore(); ledger; ledger = ledger.parent) {
    ledger.sourcedOperationAdmitted = true
  }
}

/**
 * Runs one use case for Chat under its operation's declaration: `execute` is the business phase,
 * `complete` its audit and after-success effects. A `sourced` operation that returns without
 * accounting throws rather than hand its content to a model unclassified, and one whose committed
 * write returned refused content answers with that refusal once its effects are complete. This
 * holds on every Chat path, transported or called in-process by a tool.
 */
export async function runDeclaredContentOperation<T>(
  operation: ApplicationOperation,
  principal: Principal,
  execute: () => Promise<T>,
  complete?: (result: T) => Promise<void>
): Promise<T> {
  if (!isCopilotPrincipal(principal)) {
    const result = await execute()
    await complete?.(result)
    return result
  }
  noteContentDeliveryOperation(operation, principal)
  const ledger: ContentLedger = {
    parent: ledgers.getStore(),
    declaration: operation.contentDelivery,
    sourcedOperationAdmitted: false,
    accounted: false,
    admitted: [],
  }
  const result = await ledgers.run(ledger, execute)
  await complete?.(result)
  if (ledger.failedAfterWrite) throw ledger.failedAfterWrite
  if (operation.contentDelivery === 'sourced' && !ledger.accounted) {
    throw new ContentDeliveryUnaccountedError(operation.id)
  }
  if (ledger.withheldAfterWrite) {
    throw new ContentRefusedError(ledger.withheldAfterWrite, { afterWrite: true })
  }
  return result
}
