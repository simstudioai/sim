/**
 * `workflow_source_meta`: the server-side half of the lock. It keeps the
 * facts a source file carries that the stored graph does not (each block's `const` identifier,
 * its declaration order, and comments) so they survive edits made only on the canvas and prints
 * that have no repo lock.
 *
 * Everything is keyed by **block id**, never by block key, so a canvas rename never orphans an
 * entry. Comment anchors use `encodeAnchor` with the block segment holding the block id and the
 * `var` segment holding the variable id; `header`, `wiring` and `footer` carry no id.
 *
 * Branch keys are not stored here: they persist on the condition/router rows themselves as the
 * optional row `key`, which canonicalize already reads.
 *
 * Version policy matches the lock's: adding an optional field does not bump `version`; until every
 * reader knows a field, data goes under an `x-` key, which the validator tolerates and preserves.
 */

import { isRecordLike } from '@sim/utils/object'
import { decodeAnchor, encodeAnchor } from './anchors'
import type { SourceMetaDiagnosticCode } from './diagnostics/codes'
import { diagnostic } from './diagnostics/factory'
import type { Diagnostic } from './diagnostics/frame'
import {
  fieldNames,
  isExtensionKey,
  isJson,
  isPrintOrder,
  jsonInput,
  type LockExtensionKey,
  pointer,
  readExtensions,
  readIdent,
} from './lock'
import type { Anchor, AnchorKey, CodeComment, Json } from './model'
import { deepEqual, setOwn } from './records'

export interface WorkflowSourceMetaV1 {
  [extension: LockExtensionKey]: Json
  version: 1
  /** Block id → the TS `const` identifier it prints as. Never in `SDK_RESERVED_IDENTIFIERS`. */
  idents: Record<string, string>
  /** Block id → print-order tie-break (a non-negative integer; not unique, like the lock's). */
  order: Record<string, number>
  /** Comments by id-anchored `AnchorKey`, in source order. */
  comments: Partial<Record<AnchorKey, CodeComment[]>>
}

type SourceMetaDiagnostic = Diagnostic<SourceMetaDiagnosticCode>

type ParseSourceMetaResult =
  | { meta: WorkflowSourceMetaV1; diagnostics?: undefined }
  | { meta?: undefined; diagnostics: SourceMetaDiagnostic[] }

const META_FIELDS = fieldNames<WorkflowSourceMetaV1>({
  version: true,
  idents: true,
  order: true,
  comments: true,
})
const COMMENT_FIELDS = fieldNames<CodeComment>({ text: true, kind: true, placement: true })

class SourceMetaReader {
  readonly diagnostics: SourceMetaDiagnostic[] = []

  report(code: SourceMetaDiagnosticCode, segments: readonly string[], message: string): void {
    this.diagnostics.push(diagnostic(code, message, { path: pointer(segments) }))
  }

  extensions(value: Record<string, unknown>): Record<LockExtensionKey, Json> {
    return readExtensions(value, META_FIELDS, (field, problem) =>
      problem === 'unknown'
        ? this.report(
            'E_SOURCE_META_UNKNOWN_FIELD',
            [field],
            `Unknown source meta field "${field}".`
          )
        : this.report('E_SOURCE_META_SHAPE', [field], 'An extension field must hold JSON.')
    )
  }

  idents(raw: unknown): Record<string, string> {
    if (!isRecordLike(raw)) {
      this.report('E_SOURCE_META_SHAPE', ['idents'], '"idents" must be an object.')
      return {}
    }
    const holders = new Map<string, string>()
    const entries: Array<[string, string]> = []
    for (const [blockId, value] of Object.entries(raw)) {
      const at = ['idents', blockId]
      const read = readIdent(value)
      if ('problem' in read) {
        this.report('E_SOURCE_META_IDENT', at, read.problem)
        continue
      }
      const { ident } = read
      const holder = holders.get(ident)
      if (holder !== undefined) {
        this.report(
          'E_SOURCE_META_DUPLICATE_IDENT',
          at,
          `Ident "${ident}" is already used by block "${holder}".`
        )
        continue
      }
      holders.set(ident, blockId)
      entries.push([blockId, ident])
    }
    return Object.fromEntries(entries)
  }

  order(raw: unknown): Record<string, number> {
    if (!isRecordLike(raw)) {
      this.report('E_SOURCE_META_SHAPE', ['order'], '"order" must be an object.')
      return {}
    }
    const entries: Array<[string, number]> = []
    for (const [blockId, order] of Object.entries(raw)) {
      if (isPrintOrder(order)) {
        entries.push([blockId, order])
      } else {
        this.report(
          'E_SOURCE_META_SHAPE',
          ['order', blockId],
          'An order is a non-negative integer.'
        )
      }
    }
    return Object.fromEntries(entries)
  }

  comment(raw: unknown, at: readonly string[]): CodeComment | null {
    if (!isRecordLike(raw)) {
      this.report('E_SOURCE_META_SHAPE', at, 'A comment must be an object.')
      return null
    }
    for (const field of Object.keys(raw)) {
      if (!COMMENT_FIELDS.includes(field)) {
        this.report(
          'E_SOURCE_META_UNKNOWN_FIELD',
          [...at, field],
          `Unknown comment field "${field}".`
        )
      }
    }
    const { text, kind, placement } = raw
    if (typeof text !== 'string') {
      this.report('E_SOURCE_META_SHAPE', [...at, 'text'], '"text" must be a string.')
      return null
    }
    if (kind !== 'line' && kind !== 'block') {
      this.report('E_SOURCE_META_SHAPE', [...at, 'kind'], '"kind" is "line" or "block".')
      return null
    }
    if (placement !== 'leading' && placement !== 'trailing') {
      this.report(
        'E_SOURCE_META_SHAPE',
        [...at, 'placement'],
        '"placement" is "leading" or "trailing".'
      )
      return null
    }
    return { text, kind, placement }
  }

  comments(raw: unknown): Partial<Record<AnchorKey, CodeComment[]>> {
    if (!isRecordLike(raw)) {
      this.report('E_SOURCE_META_SHAPE', ['comments'], '"comments" must be an object.')
      return {}
    }
    const result: Partial<Record<AnchorKey, CodeComment[]>> = {}
    for (const [key, list] of Object.entries(raw)) {
      const at = ['comments', key]
      const anchor = decodeAnchor(key)
      if (!anchor || encodeAnchor(anchor) !== key) {
        this.report('E_SOURCE_META_ANCHOR', at, `"${key}" is not a comment anchor.`)
        continue
      }
      if (!Array.isArray(list)) {
        this.report('E_SOURCE_META_SHAPE', at, 'Comments must be an array.')
        continue
      }
      const comments: CodeComment[] = []
      list.forEach((entry: unknown, index) => {
        const comment = this.comment(entry, [...at, String(index)])
        if (comment) comments.push(comment)
      })
      if (comments.length > 0) result[encodeAnchor(anchor)] = comments
    }
    return result
  }
}

/**
 * Validates a stored source meta value, given as parsed JSON or as JSON text. Mirrors
 * `parseWorkflowLock`: every problem is reported at once with an RFC 6901 `path`, any problem
 * rejects the whole value, unknown fields are errors except `x-` extensions (preserved), and a
 * version other than 1 stops validation there.
 */
export function parseSourceMeta(input: unknown): ParseSourceMetaResult {
  const reader = new SourceMetaReader()
  const parsed = jsonInput(input)
  if (!parsed) {
    reader.report('E_SOURCE_META_JSON', [], 'source meta is not valid JSON.')
    return { diagnostics: reader.diagnostics }
  }
  const { json } = parsed
  if (!isRecordLike(json)) {
    reader.report('E_SOURCE_META_SHAPE', [], 'source meta must be a JSON object.')
    return { diagnostics: reader.diagnostics }
  }
  if (json.version !== 1) {
    reader.report(
      'E_SOURCE_META_VERSION',
      ['version'],
      'Unsupported source meta version; expected 1.'
    )
    return { diagnostics: reader.diagnostics }
  }
  const extensions = reader.extensions(json)
  const idents = reader.idents(json.idents)
  const order = reader.order(json.order)
  const comments = reader.comments(json.comments)
  if (reader.diagnostics.length > 0) return { diagnostics: reader.diagnostics }
  return { meta: { ...extensions, version: 1, idents, order, comments } }
}

/**
 * Rewrites the ids an anchor carries: the block segment of `block`, `param` and `edges`
 * anchors through `block`, the `var` segment through `variable`. A callback returning
 * `null` drops the anchor; `header`, `wiring` and `footer` pass unchanged.
 */
export function mapAnchorIds(
  anchor: Anchor,
  block: (id: string) => string | null,
  variable: (id: string) => string | null
): Anchor | null {
  switch (anchor.kind) {
    case 'header':
    case 'wiring':
    case 'footer':
      return anchor
    case 'var': {
      const id = variable(anchor.variable)
      return id === null ? null : { ...anchor, variable: id }
    }
    default: {
      const id = block(anchor.block)
      return id === null ? null : { ...anchor, block: id }
    }
  }
}

/** The `x-` extension fields of a source meta, which every rewrite preserves. */
export function sourceMetaExtensions(meta: WorkflowSourceMetaV1): Record<LockExtensionKey, Json> {
  const extensions: Record<LockExtensionKey, Json> = {}
  for (const [field, value] of Object.entries(meta)) {
    if (isExtensionKey(field) && isJson(value)) extensions[field] = value
  }
  return extensions
}

/**
 * Maps every block id and variable id in `meta` through the callbacks; an entry whose callback
 * returns `null` is dropped. When two ids map onto one, the first entry wins, and an ident
 * already claimed is dropped, so the result always passes {@link parseSourceMeta}.
 */
function mapSourceMetaIds(
  meta: WorkflowSourceMetaV1,
  block: (id: string) => string | null,
  variable: (id: string) => string | null
): WorkflowSourceMetaV1 {
  const idents: Record<string, string> = {}
  const taken = new Set<string>()
  for (const [id, ident] of Object.entries(meta.idents)) {
    const next = block(id)
    if (next === null || Object.hasOwn(idents, next) || taken.has(ident)) continue
    setOwn(idents, next, ident)
    taken.add(ident)
  }
  const order: Record<string, number> = {}
  for (const [id, value] of Object.entries(meta.order)) {
    const next = block(id)
    if (next !== null && !Object.hasOwn(order, next)) setOwn(order, next, value)
  }
  const comments: Partial<Record<AnchorKey, CodeComment[]>> = {}
  for (const [key, list] of Object.entries(meta.comments)) {
    const anchor = decodeAnchor(key)
    const mapped = anchor ? mapAnchorIds(anchor, block, variable) : null
    if (!mapped || !list || list.length === 0) continue
    const mappedKey = encodeAnchor(mapped)
    comments[mappedKey] = [...(comments[mappedKey] ?? []), ...list]
  }
  return { ...sourceMetaExtensions(meta), version: 1, idents, order, comments }
}

/**
 * Drops every entry for a block or variable that no longer exists. `blocks` and `variables`
 * answer whether an id is still stored; an omitted predicate keeps every id of that kind.
 * Readers still tolerate stale ids: pruning is hygiene, not the correctness gate.
 */
export function pruneSourceMeta(
  meta: WorkflowSourceMetaV1,
  live: { blocks?: (id: string) => boolean; variables?: (id: string) => boolean }
): WorkflowSourceMetaV1 {
  const { blocks, variables } = live
  return mapSourceMetaIds(
    meta,
    (id) => (!blocks || blocks(id) ? id : null),
    (id) => (!variables || variables(id) ? id : null)
  )
}

/**
 * Re-keys `meta` onto a copy of its workflow (duplicate, fork, promote): each block id through
 * `blockIds` and each variable id through `variableIds`. Ids absent from a map are dropped, so a
 * copy never carries entries for blocks it did not copy.
 */
export function remapSourceMeta(
  meta: WorkflowSourceMetaV1,
  blockIds: ReadonlyMap<string, string>,
  variableIds: ReadonlyMap<string, string>
): WorkflowSourceMetaV1 {
  return mapSourceMetaIds(
    meta,
    (id) => blockIds.get(id) ?? null,
    (id) => variableIds.get(id) ?? null
  )
}

/** Whether two values hold the same entries, extensions included, in any key order. */
export function sourceMetaEquals(a: WorkflowSourceMetaV1, b: WorkflowSourceMetaV1): boolean {
  return deepEqual(a, b)
}

/** Whether `meta` holds nothing worth storing (no entries and no extensions). */
export function isEmptySourceMeta(meta: WorkflowSourceMetaV1): boolean {
  return (
    Object.keys(meta.idents).length === 0 &&
    Object.keys(meta.order).length === 0 &&
    Object.keys(meta.comments).length === 0 &&
    Object.keys(sourceMetaExtensions(meta)).length === 0
  )
}
