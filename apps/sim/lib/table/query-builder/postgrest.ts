/**
 * PostgREST filter grammar ↔ the internal `TablePredicate` IR.
 *
 * This is the v2 wire/authoring grammar: a PostgREST-style querystring fragment
 * that mothership and clients write, parsed here into the same `TablePredicate`
 * the engine already compiles (`buildPredicateClause` → `fieldPredicate`). The
 * parser is the validator now that the boundary param is an opaque string —
 * unknown ops, bad fields, and malformed input throw `TableQueryValidationError`
 * (mapped to HTTP 400). Values are never interpolated into SQL; they ride through
 * the parameterized `fieldPredicate` leaf.
 *
 * Supported (PostgREST token → FilterOp): eq, neq→ne, gt, gte, lt, lte,
 * in, like, ilike, match, imatch, is.null→isNull. Negation `not.` is supported
 * for `eq`→ne, `in`→nin, `is.null`→isNotNull, `like`→nlike, and `ilike`→nilike.
 * Logic: top-level `&` (AND), `and=(...)`, `or=(...)`, and nested
 * `and(...)`/`or(...)` inside groups.
 *
 * Values containing reserved characters are double-quoted; a literal `"` or `\`
 * inside a quoted value is backslash-escaped (`\"`, `\\`). The builder-only
 * emptiness ops have no single PostgREST form and serialize to desugared groups:
 * isEmpty → `or=(f.is.null,f.eq."")`, isNotEmpty → `and=(f.not.is.null,f.neq."")`.
 *
 * Unsupported (clear error): cs, cd, ov, fts/plfts/phfts/wfts, sl/sr/nxr/nxl/adj
 * (no array/range/full-text columns), and `not.<op>` outside eq/in/is.null/like/ilike.
 */

import { NAME_PATTERN } from '@/lib/table/constants'
import { TableQueryValidationError } from '@/lib/table/errors'
import type {
  ColumnDefinition,
  FilterOp,
  JsonValue,
  Predicate,
  PredicateNode,
  SortDirection,
  SortSpec,
  TablePredicate,
} from '@/lib/table/types'

type ColumnType = ColumnDefinition['type']

const MAX_FILTER_LENGTH = 4096

/** Ops whose value is a text pattern — never coerced to number/boolean. */
const TEXT_OPS = new Set<FilterOp>(['like', 'ilike', 'nlike', 'nilike', 'match', 'imatch'])

/* ------------------------------- parsing ------------------------------- */

/**
 * Splits on a delimiter at depth 0, respecting `(...)` nesting and `"..."`
 * quotes. Inside quotes, a backslash escapes the next character (`\"`, `\\`),
 * matching what {@link serializeValue} emits.
 */
function splitTopLevel(input: string, delimiter: string): string[] {
  const parts: string[] = []
  let depth = 0
  let inQuotes = false
  let current = ''
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    if (inQuotes && ch === '\\' && i + 1 < input.length) {
      current += ch + input[i + 1]
      i++
    } else if (ch === '"') {
      inQuotes = !inQuotes
      current += ch
    } else if (inQuotes) {
      current += ch
    } else if (ch === '(') {
      depth++
      current += ch
    } else if (ch === ')') {
      depth--
      if (depth < 0) throw new TableQueryValidationError('Unbalanced parentheses in filter')
      current += ch
    } else if (ch === delimiter && depth === 0) {
      parts.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  if (depth !== 0 || inQuotes) {
    throw new TableQueryValidationError('Unbalanced parentheses or quotes in filter')
  }
  parts.push(current)
  return parts
}

/**
 * Strips one layer of PostgREST double-quoting and unescapes `\"`/`\\`,
 * the inverse of {@link serializeValue}.
 */
function unquote(raw: string): string {
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    return raw.slice(1, -1).replace(/\\(["\\])/g, '$1')
  }
  return raw
}

function validateField(field: string): void {
  if (!NAME_PATTERN.test(field)) {
    throw new TableQueryValidationError(
      `Invalid filter column "${field}". Use a column name (letters, digits, underscore).`
    )
  }
}

/** Coerces a raw PostgREST value string to the column's stored JSON type. */
function coerceValue(raw: string, type: ColumnType | undefined): JsonValue {
  const v = unquote(raw)
  if (type === 'number') {
    const n = Number(v)
    if (v.trim() === '' || !Number.isFinite(n)) {
      throw new TableQueryValidationError(`Expected a number for column value, got "${v}"`)
    }
    return n
  }
  if (type === 'boolean') {
    if (v === 'true') return true
    if (v === 'false') return false
    throw new TableQueryValidationError(`Expected true/false for boolean column, got "${v}"`)
  }
  // string / date / json: keep as text (dates compare as ISO strings).
  return v
}

/** Parses a PostgREST list literal `(a,b,"c,d")` into its elements. */
function parseList(raw: string): string[] {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('(') || !trimmed.endsWith(')')) {
    throw new TableQueryValidationError(`Expected a list like in.(a,b), got "${raw}"`)
  }
  const inner = trimmed.slice(1, -1)
  if (inner.trim() === '') return []
  return splitTopLevel(inner, ',').map((s) => s.trim())
}

const UNSUPPORTED_OPS: Record<string, string> = {
  cs: 'array/jsonb containment',
  cd: 'array/jsonb containment',
  ov: 'array/range overlap',
  fts: 'full-text search',
  plfts: 'full-text search',
  phfts: 'full-text search',
  wfts: 'full-text search',
  sl: 'range',
  sr: 'range',
  nxr: 'range',
  nxl: 'range',
  adj: 'range',
}

/**
 * Parses one leaf `field` + `op.value` spec into a `Predicate`. `opSpec` is the
 * part after the field (e.g. `gte.10`, `in.(a,b)`, `is.null`, `not.eq.5`).
 */
function parseLeaf(field: string, opSpec: string, typeByName: Map<string, ColumnType>): Predicate {
  validateField(field)
  const type = typeByName.get(field)

  let negated = false
  let rest = opSpec
  if (rest.startsWith('not.')) {
    negated = true
    rest = rest.slice(4)
  }

  const dot = rest.indexOf('.')
  if (dot === -1) throw new TableQueryValidationError(`Malformed filter on "${field}": "${opSpec}"`)
  const token = rest.slice(0, dot)
  const rawValue = rest.slice(dot + 1)

  if (UNSUPPORTED_OPS[token]) {
    throw new TableQueryValidationError(
      `Operator "${token}" (${UNSUPPORTED_OPS[token]}) is not supported on user tables.`
    )
  }

  // is.null / is.true / is.false
  if (token === 'is') {
    if (rawValue === 'null') {
      return { field, op: negated ? 'isNotNull' : 'isNull' }
    }
    if (rawValue === 'true' || rawValue === 'false') {
      if (negated) throw unsupportedNegation(token)
      return { field, op: 'eq', value: rawValue === 'true' }
    }
    throw new TableQueryValidationError(
      `Unsupported "is.${rawValue}" — use is.null, is.true, is.false`
    )
  }

  if (token === 'in') {
    const items = parseList(rawValue).map((el) => coerceValue(el, type))
    if (items.length === 0) {
      // An empty list would compile to no condition at all and silently widen
      // the match — reject instead.
      throw new TableQueryValidationError(`Empty in.() list on column "${field}"`)
    }
    return { field, op: negated ? 'nin' : 'in', value: items }
  }

  // Scalar / text ops
  const opMap: Record<string, FilterOp> = {
    eq: 'eq',
    neq: 'ne',
    gt: 'gt',
    gte: 'gte',
    lt: 'lt',
    lte: 'lte',
    like: 'like',
    ilike: 'ilike',
    match: 'match',
    imatch: 'imatch',
  }
  const op = opMap[token]
  if (!op) {
    throw new TableQueryValidationError(`Unknown filter operator "${token}" on column "${field}".`)
  }
  if (negated) {
    if (op === 'eq') return { field, op: 'ne', value: scalarValue(rawValue, op, type) }
    if (op === 'like') return { field, op: 'nlike', value: scalarValue(rawValue, 'like', type) }
    if (op === 'ilike') return { field, op: 'nilike', value: scalarValue(rawValue, 'ilike', type) }
    throw unsupportedNegation(token)
  }
  return { field, op, value: scalarValue(rawValue, op, type) }
}

function scalarValue(raw: string, op: FilterOp, type: ColumnType | undefined): JsonValue {
  // Text/pattern ops keep the raw string (the `*` wildcard and regex are textual).
  if (TEXT_OPS.has(op)) return unquote(raw)
  return coerceValue(raw, type)
}

function unsupportedNegation(token: string): TableQueryValidationError {
  return new TableQueryValidationError(
    `Negation "not.${token}" is not supported — only not.eq, not.in, not.is.null, not.like, not.ilike.`
  )
}

/** Parses the comma-separated items inside an `and(...)`/`or(...)` group. */
function parseGroupItems(content: string, typeByName: Map<string, ColumnType>): PredicateNode[] {
  return splitTopLevel(content, ',').map((item) => parseGroupItem(item.trim(), typeByName))
}

/** A single item inside a group: a nested `and()/or()` group, or a `field.op.value` leaf. */
function parseGroupItem(item: string, typeByName: Map<string, ColumnType>): PredicateNode {
  const groupMatch = /^(and|or)\((.*)\)$/s.exec(item)
  if (groupMatch) {
    const members = parseGroupItems(groupMatch[2], typeByName)
    return groupMatch[1] === 'and' ? { all: members } : { any: members }
  }
  // Leaf in dot-form: field.op.value — field is up to the first dot.
  const dot = item.indexOf('.')
  if (dot === -1) throw new TableQueryValidationError(`Malformed filter condition: "${item}"`)
  return parseLeaf(item.slice(0, dot), item.slice(dot + 1), typeByName)
}

/**
 * Parses a PostgREST filter querystring fragment into a `TablePredicate`.
 * Top-level `&`-separated params AND together; `and=(...)`/`or=(...)` form groups.
 */
export function parsePostgrestFilter(input: string, columns: ColumnDefinition[]): TablePredicate {
  if (typeof input !== 'string' || input.trim() === '') {
    throw new TableQueryValidationError('Filter is empty')
  }
  if (input.length > MAX_FILTER_LENGTH) {
    throw new TableQueryValidationError(`Filter exceeds ${MAX_FILTER_LENGTH} characters`)
  }
  const typeByName = new Map<string, ColumnType>(columns.map((c) => [c.name, c.type]))

  const nodes: PredicateNode[] = []
  for (const segment of splitTopLevel(input, '&')) {
    const trimmed = segment.trim()
    if (trimmed === '') continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) throw new TableQueryValidationError(`Malformed filter param: "${trimmed}"`)
    const key = trimmed.slice(0, eq).trim()
    const rhs = trimmed.slice(eq + 1).trim()

    if (key === 'and' || key === 'or') {
      const members = parseList(rhs)
      if (members.length === 0) {
        // An empty group compiles to no condition — a silent no-op filter.
        throw new TableQueryValidationError(`Empty ${key}=() group in filter`)
      }
      // re-parse as group items (parseList split top-level commas already)
      const parsed = members.map((m) => parseGroupItem(m, typeByName))
      nodes.push(key === 'and' ? { all: parsed } : { any: parsed })
      continue
    }
    nodes.push(parseLeaf(key, rhs, typeByName))
  }

  if (nodes.length === 0) throw new TableQueryValidationError('Filter has no conditions')
  return { all: nodes }
}

/** Parses a PostgREST `order` value (`col.desc,col2.asc`) into a SortSpec. */
export function parsePostgrestOrder(input: string, columns: ColumnDefinition[]): SortSpec {
  const valid = new Set(columns.map((c) => c.name).concat(['createdAt', 'updatedAt']))
  const spec: SortSpec = []
  for (const part of input.split(',')) {
    const seg = part.trim()
    if (seg === '') continue
    const segments = seg.split('.')
    if (segments.length > 2) {
      throw new TableQueryValidationError(`Malformed sort "${seg}" — use column or column.desc`)
    }
    const [field, dirRaw = 'asc'] = segments
    validateField(field)
    if (!valid.has(field)) {
      throw new TableQueryValidationError(`Unknown sort column "${field}"`)
    }
    // Strict: a typo'd direction must not silently sort ascending.
    if (dirRaw !== 'asc' && dirRaw !== 'desc') {
      throw new TableQueryValidationError(
        `Unknown sort direction "${dirRaw}" on "${field}" — use asc or desc (lowercase)`
      )
    }
    const direction: SortDirection = dirRaw
    spec.push({ field, direction })
  }
  return spec
}

/* ------------------------------ serializing ------------------------------ */

function leafToOpSpec(p: Predicate): string {
  const v = p.value
  switch (p.op) {
    case 'eq':
      return `eq.${serializeValue(v)}`
    case 'ne':
      return `neq.${serializeValue(v)}`
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
      return `${p.op}.${serializeValue(v)}`
    case 'in':
      return `in.(${(v as JsonValue[]).map(serializeValue).join(',')})`
    case 'nin':
      return `not.in.(${(v as JsonValue[]).map(serializeValue).join(',')})`
    case 'like':
    case 'ilike':
    case 'match':
    case 'imatch':
      return `${p.op}.${serializeValue(v)}`
    case 'nlike':
      return `not.like.${serializeValue(v)}`
    case 'nilike':
      return `not.ilike.${serializeValue(v)}`
    // Builder-only substring ops: build the whole wildcard pattern FIRST, then
    // serialize it as ONE value, so quoting wraps the entire pattern and the
    // parser's whole-value unquote recovers it (`ilike."*example.com*"`).
    case 'contains':
      return `ilike.${serializeValue(`*${asText(v)}*`)}`
    case 'ncontains':
      return `not.ilike.${serializeValue(`*${asText(v)}*`)}`
    case 'startsWith':
      return `ilike.${serializeValue(`${asText(v)}*`)}`
    case 'endsWith':
      return `ilike.${serializeValue(`*${asText(v)}`)}`
    case 'isNull':
      return 'is.null'
    case 'isNotNull':
      return 'not.is.null'
    default:
      // isEmpty/isNotEmpty are desugared into groups before leaves serialize.
      throw new TableQueryValidationError(`Cannot serialize operator "${p.op}"`)
  }
}

function asText(value: JsonValue | undefined): string {
  return value === null || value === undefined ? '' : String(value)
}

/**
 * Quotes values containing reserved chars (and the empty string) so they
 * survive a round-trip; literal `"`/`\` inside a quoted value are escaped.
 * Inverse of {@link unquote}.
 */
function serializeValue(value: JsonValue | undefined): string {
  const s = value === null || value === undefined ? 'null' : String(value)
  if (s === '') return '""'
  if (!/[,.()&="\\]/.test(s)) return s
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function isGroup(node: PredicateNode): node is TablePredicate {
  return 'all' in node || 'any' in node
}

/**
 * Rewrites emptiness leaves into their PostgREST-expressible groups, preserving
 * the legacy "null OR empty string" semantics through the string round-trip:
 * isEmpty → `(f is null OR f = '')`, isNotEmpty → `(f not null AND f <> '')`.
 */
function desugarEmptiness(node: PredicateNode): PredicateNode {
  if (isGroup(node)) {
    return 'all' in node
      ? { all: node.all.map(desugarEmptiness) }
      : { any: node.any.map(desugarEmptiness) }
  }
  if (node.op === 'isEmpty') {
    return {
      any: [
        { field: node.field, op: 'isNull' },
        { field: node.field, op: 'eq', value: '' },
      ],
    }
  }
  if (node.op === 'isNotEmpty') {
    return {
      all: [
        { field: node.field, op: 'isNotNull' },
        { field: node.field, op: 'ne', value: '' },
      ],
    }
  }
  return node
}

/** Serializes a node as a group item (dot-form leaves, function-form groups). */
function nodeToGroupItem(node: PredicateNode): string {
  if (isGroup(node)) {
    const isAll = 'all' in node
    const members = isAll ? node.all : node.any
    // A single-member group adds no logic — flatten it so a builder-emitted
    // `{ all: [leaf] }` serializes to the leaf, not a redundant `and(leaf)`.
    if (members.length === 1) return nodeToGroupItem(members[0])
    return `${isAll ? 'and' : 'or'}(${members.map(nodeToGroupItem).join(',')})`
  }
  return `${node.field}.${leafToOpSpec(node)}`
}

/**
 * Serializes a `TablePredicate` to a PostgREST querystring fragment (for the
 * builder UI). A top-level `all` becomes `&`-joined params; `any` becomes
 * `or=(...)`; nested groups use the function form.
 */
export function predicateToPostgrest(predicate: TablePredicate): string {
  const desugared = desugarEmptiness(predicate) as TablePredicate
  if ('any' in desugared) {
    return `or=(${desugared.any.map(nodeToGroupItem).join(',')})`
  }
  return desugared.all
    .map((node) =>
      isGroup(node)
        ? `${'all' in node ? 'and' : 'or'}=(${(('all' in node ? node.all : node.any) as PredicateNode[]).map(nodeToGroupItem).join(',')})`
        : `${node.field}=${leafToOpSpec(node)}`
    )
    .join('&')
}

/** Serializes a SortSpec to a PostgREST `order` value. */
export function sortSpecToPostgrestOrder(sort: SortSpec): string {
  return sort.map((s) => `${s.field}.${s.direction}`).join(',')
}
