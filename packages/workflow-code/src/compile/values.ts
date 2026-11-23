import type {
  ArrayExpression,
  CallExpression,
  Expression,
  MemberExpression,
  Node,
  ObjectExpression,
  ObjectProperty,
  TaggedTemplateExpression,
} from '@babel/types'
import { isRecordLike } from '@sim/utils/object'
import { findWorkflowReferenceTokens } from '@sim/utils/workflow-references'
import {
  isReservedWorkflowBlockName,
  normalizeWorkflowBlockName,
} from '@sim/workflow-types/workflow'
import { literalText, memberName, memberSegment } from '../babel'
import { builderOutputSchemas } from '../catalog/activity'
import type { CatalogOutput } from '../catalog/types'
import {
  ENV_VAR_NAME,
  formatMemberPath,
  formatStoredPath,
  LOOP_PROPERTIES,
  PARALLEL_PROPERTIES,
  parseStoredPath,
  type RefSegment,
} from '../code-files/ref-path'
import { REF_ROOT } from '../code-files/to-file'
import { type ContainerKind, readsIterationOutOfScope, type ScopeNode } from '../iteration-scope'
import {
  JsonRef,
  type JsonTree,
  jsonFieldText,
  responseFormatFields,
  valueTree,
} from '../json-fields'
import { SOURCE_ENTRY_FILE } from '../limits'
import {
  type BlockKey,
  type CanonicalBlock,
  type CanonicalParam,
  isResourceKind,
  type Json,
  type ResourceKind,
  type SubBlockId,
  type Value,
  type VarNode,
} from '../model'
import { getOwn, setOwn } from '../records'
import { isTemplateTag, SDK_RESOURCE_CALLS, type SdkCoreExport, TEMPLATE_TAGS } from '../sdk'
import { inputFormatFields } from '../start-inputs'
import {
  type BlockDecl,
  type CompileContext,
  catalogBlockOf,
  containerKindOf,
  enclosingContainers,
  type JsonFieldEntry,
  type LiteralTag,
  lookup,
  rangeOf,
  reportNotImported,
  reportUnresolvedIdentifier,
  type Scope,
  unsupported,
} from './context'
import { didYouMean, HINTS, hintForNode, nodeLabel } from './hints'
import type { Range } from './report'

/** Where a value is compiled: the block it belongs to and the scope its identifiers resolve in. */
export interface ValueSite {
  decl: BlockDecl
  scope: Scope
  /**
   * Inside a variables-input field (`structured: 'variables'`), a bare `vars.k` is the variable
   * itself (`{ $sim: 'var', key }`, the stored `variableId`); everywhere else it is the
   * `<variable.k>` reference text. The printer draws the same line (whole-string refs in such a
   * field print as templates).
   */
  varNodes?: boolean
}

/**
 * How a value was written, which picks the member of a basic/advanced pair and
 * decides whether `W_VALUE_KIND` applies (only to literals).
 */
type ValueForm = 'literal' | 'ref' | 'template' | 'resource' | 'file' | 'raw'

export type CompiledValue =
  | { kind: 'value'; value: Value; form: ValueForm }
  /** `todo()`: compiles to absent. */
  | { kind: 'todo' }
  /** `null` at the top of a param: a stored `null` is absent. */
  | { kind: 'absent' }
  /** `stored()`: the value the stored block holds for this param (`CompileInput.stored`). */
  | { kind: 'stored' }
  /** `codeFile('./x.js')`: only valid as a function block's code. */
  | { kind: 'codeFile'; path: string; pathNode: Node }

const SELECTOR_FORMS: ReadonlySet<ValueForm> = new Set(['resource', 'file'])

/** Whether the value was written as a resource or file reference, which the workspace's selectors resolve. */
export function isSelectorForm(form: ValueForm): boolean {
  return SELECTOR_FORMS.has(form)
}

/** Call-form resource constructors and the kind each produces. */
const RESOURCE_KIND_BY_CALL: ReadonlyMap<string, ResourceKind> = new Map(
  Object.entries(SDK_RESOURCE_CALLS).flatMap(([kind, call]) =>
    isResourceKind(kind) ? [[call, kind]] : []
  )
)

/** SDK functions that are values, not block builders. */
export const SDK_VALUE_FUNCTIONS: ReadonlySet<string> = new Set([
  ...Object.values(SDK_RESOURCE_CALLS),
  ...TEMPLATE_TAGS,
  'raw',
  'todo',
  'stored',
  'ref',
  'codeFile',
  'edge',
  'env',
  'vars',
] as const satisfies readonly SdkCoreExport[])

/** Named-form container outputs (`LoopResolver` / `ParallelResolver` `KNOWN_PROPERTIES`). */
const CONTAINER_OUTPUTS = ['results', 'result']

function rejectNode(ctx: CompileContext, node: Node, site?: ValueSite): null {
  return unsupported(
    ctx,
    node,
    `${nodeLabel(node)} is not supported in a workflow file.`,
    hintForNode(node),
    site?.decl.key
  )
}

/** The literal text of a property key, or `null` (after reporting) for a computed key. */
function propertyKey(ctx: CompileContext, property: ObjectProperty): string | null {
  if (property.computed) {
    return unsupported(ctx, property, 'Computed keys are not supported.', HINTS.computedKey)
  }
  const key = property.key
  if (key.type === 'Identifier') return key.name
  if (key.type === 'StringLiteral') return key.value
  if (key.type === 'NumericLiteral') return String(key.value)
  return unsupported(ctx, property, 'Use an identifier or string key.', HINTS.computedKey)
}

/**
 * The properties of an object literal as `[key, property]`, rejecting methods, getters, spreads,
 * computed keys and duplicate keys. A rejected property is reported and left out, so fewer
 * entries than `node.properties` means something was rejected.
 */
export function objectEntries(
  ctx: CompileContext,
  node: ObjectExpression,
  onDuplicate?: (property: ObjectProperty, key: string) => void
): Array<[string, ObjectProperty]> {
  const entries: Array<[string, ObjectProperty]> = []
  const seen = new Set<string>()
  for (const property of node.properties) {
    if (property.type !== 'ObjectProperty') {
      rejectNode(ctx, property)
      continue
    }
    const key = propertyKey(ctx, property)
    if (key === null) continue
    if (seen.has(key)) {
      if (onDuplicate) onDuplicate(property, key)
      else unsupported(ctx, property, `The key ${key} is written twice.`, HINTS.duplicateKey)
      continue
    }
    seen.add(key)
    entries.push([key, property])
  }
  return entries
}

/** A declared block as the iteration-scope rule reads it. */
function scopeNodeOf(ctx: CompileContext, key: BlockKey): ScopeNode | undefined {
  const decl = ctx.declsByKey.get(key)
  return decl && { kind: containerKindOf(decl), parent: decl.parent?.key ?? null }
}

/**
 * Reports `W_REF_OUT_OF_SCOPE` when block `siteKey` reads iteration field `property` of a
 * container it is not inside (see {@link readsIterationOutOfScope}): `container` is a declared
 * loop or parallel (`lp.index`, `$ref.lp.index`), or the kind whose innermost enclosing container
 * `<loop.index>` names.
 */
function checkIterationScope(
  ctx: CompileContext,
  at: Range,
  siteKey: BlockKey,
  container: BlockDecl | ContainerKind,
  property: string
): void {
  const site = ctx.declsByKey.get(siteKey)
  if (!site) return
  const nodeOf = (key: BlockKey) => scopeNodeOf(ctx, key)
  if (!readsIterationOutOfScope(siteKey, container, property, nodeOf)) return
  if (typeof container === 'string') {
    ctx.reporter.report(
      'W_REF_OUT_OF_SCOPE',
      `${site.name} reads the enclosing ${container}'s ${property}, but it sits in no ${container}, so the reference resolves to nothing at run time.`,
      at,
      {
        hint: `Move ${site.name} into a ${container}'s body, or read a ${container}'s results after it finishes.`,
        blockKey: siteKey,
      }
    )
    return
  }
  ctx.reporter.report(
    'W_REF_OUT_OF_SCOPE',
    `${site.name} reads ${container.name}'s ${property}, but it is not inside ${container.name}; outside it a ${containerKindOf(container)} outputs only results, so the run fails.`,
    at,
    {
      hint: `Move ${site.name} into ${container.name}'s body, or read ${container.ident ?? container.key}.results after it finishes.`,
      blockKey: siteKey,
    }
  )
}

/**
 * {@link checkIterationScope} for a reference path (`<head.property>` text, a code file's
 * `$ref.head.property`) whose head is `loop`, `parallel` or a declared container's key.
 */
function checkIterationTag(
  ctx: CompileContext,
  at: Range,
  siteKey: BlockKey,
  segments: readonly RefSegment[]
): void {
  const [head, property] = segments
  if (head?.kind !== 'name' || property?.kind !== 'name') return
  if (head.name === 'loop' || head.name === 'parallel') {
    checkIterationScope(ctx, at, siteKey, head.name, property.name)
    return
  }
  const target = ctx.declsByKey.get(head.name)
  if (target) checkIterationScope(ctx, at, siteKey, target, property.name)
}

/**
 * Checks each hand-written `<Name.path>` in literal text whose head is not a normalized block key,
 * or names no declared block. Such text is kept verbatim, so a rename in the same apply never
 * rewrites it; the block's ident is the reference that follows the block. A head written other
 * than as its block's key is `W_REF_NOT_NORMALIZED`. A path whose head names no block at all
 * waits for {@link checkUnresolvedTags}, which knows the apply's renames.
 */
function checkLiteralRefs(ctx: CompileContext, node: Node, text: string, site: ValueSite): void {
  // A note never runs, so nothing in it resolves: `<b>` in its markdown is text, not a reference.
  if (catalogBlockOf(site.decl)?.graph.annotationOnly) return
  for (const token of findWorkflowReferenceTokens(text)) {
    if (token.kind !== 'workflow') continue
    const segments = parseStoredPath(token.value.slice(1, -1))
    const head = segments?.[0]
    if (!segments || head?.kind !== 'name') continue
    const normalized = normalizeWorkflowBlockName(head.name)
    if (
      normalized === head.name &&
      (isReservedWorkflowBlockName(head.name) || ctx.declsByKey.has(head.name))
    ) {
      checkIterationTag(ctx, rangeOf(ctx, node), site.decl.key, segments)
      continue
    }
    const tag = {
      token: token.value,
      segments,
      normalized,
      at: rangeOf(ctx, node),
      blockKey: site.decl.key,
    }
    if (!ctx.declsByKey.has(normalized) && segments.length > 1) ctx.unresolvedTags.push(tag)
    else reportNotNormalized(ctx, tag)
  }
}

function reportNotNormalized(ctx: CompileContext, tag: LiteralTag): void {
  const target = ctx.declsByKey.get(tag.normalized)
  ctx.reporter.report(
    'W_REF_NOT_NORMALIZED',
    target
      ? `${tag.token} is not written with the block key ${tag.normalized}; the text is kept as written.`
      : `${tag.token} names no block; the text is kept as written.`,
    tag.at,
    {
      hint: () =>
        target?.ident
          ? `Write \${${formatMemberPath(target.ident, tag.segments.slice(1))}} in a template, so a rename follows the block.`
          : 'Reference a declared block through its ident, so a rename follows the block.',
      blockKey: tag.blockKey,
    }
  )
}

/**
 * Reports each literal `<name.path>` whose head names no block once the apply's renames are known
 * (`renamed`, stored key → source key). The apply rewrites a renamed block's stored key to its new
 * one, so such a head still resolves and stays `W_REF_NOT_NORMALIZED`; any other names no block,
 * which the run cannot resolve: `W_UNRESOLVED_REF`, refused on a block the edit changed, as the
 * server's lint refuses a dangling reference.
 */
export function checkUnresolvedTags(
  ctx: CompileContext,
  renamed: ReadonlyMap<BlockKey, BlockKey>
): void {
  for (const tag of ctx.unresolvedTags) {
    if (renamed.has(tag.normalized)) {
      reportNotNormalized(ctx, tag)
      continue
    }
    ctx.reporter.report(
      'W_UNRESOLVED_REF',
      `${tag.token} names no block, so it does not resolve at run time.`,
      tag.at,
      {
        hint: 'Reference a declared block through its ident, so a rename follows the block.',
        blockKey: tag.blockKey,
      }
    )
  }
}

/** Unwraps literal nodes back to stored JSON; `null` when the value holds any other node. */
function toStoredJson(value: Value): Json | null {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) {
    const items: Json[] = []
    for (const item of value) {
      const json = toStoredJson(item)
      if (json === null && item !== null) return null
      items.push(json)
    }
    return items
  }
  if ('$sim' in value) {
    return value.$sim === 'literal' && 'value' in value ? (value.value as Json) : null
  }
  const result: Record<string, Json> = {}
  for (const [key, entry] of Object.entries(value)) {
    const json = toStoredJson(entry)
    if (json === null && entry !== null) return null
    setOwn(result, key, json)
  }
  return result
}

/** Whether an object with a `$sim` key is a well-formed canonical node. */
function isCanonicalNode(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value).sort()
  const only = (...expected: string[]) => keys.join(',') === [...expected].sort().join(',')
  switch (value.$sim) {
    case 'var':
      return only('$sim', 'key') && typeof value.key === 'string'
    case 'resource':
      return (
        only('$sim', 'kind', 'key') && isResourceKind(value.kind) && typeof value.key === 'string'
      )
    case 'unresolved':
      return (
        only('$sim', 'kind', 'id') &&
        (value.kind === 'var' || isResourceKind(value.kind)) &&
        typeof value.id === 'string'
      )
    case 'csv':
      return (
        only('$sim', 'items') &&
        Array.isArray(value.items) &&
        value.items.every(
          (item) =>
            isRecordLike(item) &&
            (item.$sim === 'resource' || item.$sim === 'unresolved') &&
            isCanonicalNode(item)
        )
      )
    case 'literal':
      return only('$sim', 'value')
    default:
      return false
  }
}

/**
 * A literal-only JSON value (variables, a container's `extra` data, retry, tool policy): strings,
 * numbers, booleans, null, arrays and objects as plain data, so a `$sim` key is just a key. No refs,
 * no SDK calls. `undefined` after reporting an error.
 */
export function compileJsonLiteral(
  ctx: CompileContext,
  node: Node,
  site?: ValueSite
): Json | undefined {
  switch (node.type) {
    case 'StringLiteral':
    case 'BooleanLiteral':
    case 'NumericLiteral':
      return node.value
    case 'NullLiteral':
      return null
    case 'TemplateLiteral': {
      const text = literalText(node)
      if (text === null) {
        unsupported(ctx, node, 'Write literals only here.', HINTS.untaggedTemplate, site?.decl.key)
        return undefined
      }
      return text
    }
    case 'UnaryExpression':
      if (node.operator === '-' && node.argument.type === 'NumericLiteral') {
        return -node.argument.value
      }
      rejectNode(ctx, node, site)
      return undefined
    case 'ArrayExpression': {
      const items: Json[] = []
      for (const element of node.elements) {
        if (!element || element.type === 'SpreadElement') {
          unsupported(
            ctx,
            element ?? node,
            'Write each element explicitly.',
            HINTS.spread,
            site?.decl.key
          )
          return undefined
        }
        const item = compileJsonLiteral(ctx, element, site)
        if (item === undefined) return undefined
        items.push(item)
      }
      return items
    }
    case 'ObjectExpression': {
      const result: Record<string, Json> = {}
      const entries = objectEntries(ctx, node)
      if (entries.length !== node.properties.length) return undefined
      for (const [key, property] of entries) {
        const item = compileJsonLiteral(ctx, property.value, site)
        if (item === undefined) return undefined
        setOwn(result, key, item)
      }
      return result
    }
    default:
      unsupported(
        ctx,
        node,
        'Write literals only here.',
        'Write the stored value as a literal.',
        site?.decl.key
      )
      return undefined
  }
}

/** Whether every `$sim` object in a raw value is a well-formed canonical node. */
function canonicalNodesValid(value: Json): boolean {
  if (Array.isArray(value)) return value.every(canonicalNodesValid)
  if (value === null || typeof value !== 'object') return true
  if (Object.hasOwn(value, '$sim')) {
    if (!isCanonicalNode(value)) return false
    return value.$sim === 'literal' || Object.values(value).every(canonicalNodesValid)
  }
  return Object.values(value).every(canonicalNodesValid)
}

/**
 * `raw(v)`: `v` is the canonical value verbatim, so `$sim` objects are canonical nodes (checked
 * for shape) rather than data; a `literal` node's `value` is data and is not inspected. Only
 * literals are allowed inside.
 */
function rawLiteral(ctx: CompileContext, node: Node, site?: ValueSite): Value | undefined {
  const value = compileJsonLiteral(ctx, node, site)
  if (value === undefined) return undefined
  if (!canonicalNodesValid(value)) {
    unsupported(
      ctx,
      node,
      'This $sim object is not a canonical node.',
      "Use { $sim: 'resource', kind, key }, { $sim: 'unresolved', kind, id }, { $sim: 'var', key }, { $sim: 'csv', items } or { $sim: 'literal', value }.",
      site?.decl.key
    )
    return undefined
  }
  return value
}

/** The identifier at the root of a callee, and the member names after it. */
export function calleePath(node: Node): { root: string; rest: string[]; rootNode: Node } | null {
  const rest: string[] = []
  let current: Node = node
  while (current.type === 'MemberExpression') {
    if (current.computed || current.property.type !== 'Identifier') return null
    rest.unshift(current.property.name)
    current = current.object
  }
  return current.type === 'Identifier' ? { root: current.name, rest, rootNode: current } : null
}

/** The SDK export a call targets (`binding`, `slack.sendMessage`, ...), or `null`. */
function sdkCallPath(scope: Scope, call: CallExpression): string | null {
  const path = calleePath(call.callee)
  if (!path) return null
  const binding = lookup(scope, path.root)
  if (!binding || binding.kind !== 'sdk') return null
  return [binding.name, ...path.rest].join('.')
}

function singleStringArgument(
  ctx: CompileContext,
  call: CallExpression,
  name: string,
  site: ValueSite
): { text: string; node: Node } | null {
  const [argument, ...extra] = call.arguments
  const text = argument ? literalText(argument) : null
  if (!argument || text === null || extra.length > 0) {
    return unsupported(
      ctx,
      call,
      `${name}() takes one string literal.`,
      `Write ${name}('key').`,
      site.decl.key
    )
  }
  return { text, node: argument }
}

function flattenMembers(node: MemberExpression): { root: Expression; members: MemberExpression[] } {
  const members: MemberExpression[] = [node]
  let object = node.object
  while (object.type === 'MemberExpression') {
    members.push(object)
    object = object.object
  }
  members.reverse()
  return { root: object, members }
}

/** {@link memberSegment}, reporting why a member access is not a reference path segment. */
function compileMemberSegment(
  ctx: CompileContext,
  member: MemberExpression,
  site: ValueSite
): RefSegment | null {
  const segment = memberSegment(member)
  if (segment) return segment
  const property = member.property
  if (!member.computed) return rejectNode(ctx, member, site)
  if (property.type === 'StringLiteral') {
    return unsupported(
      ctx,
      property,
      `The path segment '${property.value}' cannot be written as a reference.`,
      "Use ref('block.path') for this spelling.",
      site.decl.key
    )
  }
  return unsupported(
    ctx,
    member,
    'Element access needs a literal key.',
    HINTS.elementAccess,
    site.decl.key
  )
}

function outputKnown(outputs: Record<string, CatalogOutput>, segments: RefSegment[]): boolean {
  let level: Record<string, CatalogOutput> | undefined = outputs
  for (const segment of segments) {
    if (!level) return true
    if (segment.kind === 'index') return true
    const output: CatalogOutput | undefined = getOwn(level, segment.name)
    if (!output) return false
    if (!output.properties) return true
    level = output.properties
  }
  return true
}

/**
 * The fix for a path {@link outputKnown} rejects: a did-you-mean over the names where it first
 * misses, else those names (`Outputs: data, status.`, or `headers holds: contentType.` below the
 * top level).
 */
function unknownOutputHint(
  outputs: Record<string, CatalogOutput>,
  segments: RefSegment[]
): string | undefined {
  let level = outputs
  for (const [index, segment] of segments.entries()) {
    if (segment.kind === 'index') return undefined
    const output = getOwn(level, segment.name)
    if (output?.properties) {
      level = output.properties
      continue
    }
    if (output) return undefined
    const names = Object.keys(level)
    if (names.length === 0) return undefined
    return (
      didYouMean(segment.name, names) ??
      (index === 0
        ? `Outputs: ${names.join(', ')}.`
        : `${formatStoredPath(segments.slice(0, index))} holds: ${names.join(', ')}.`)
    )
  }
  return undefined
}

/**
 * Compiles an identifier or member chain to its stored token text: a block chain to
 * `<key.path>`, `vars.x` to `<variable.x>`, `env.X` to `{{X}}`, a loop param to `<loop.prop>` (innermost loop of its kind) or `<key.prop>` (named form).
 */
function compileRef(ctx: CompileContext, node: Node, site: ValueSite): string | VarNode | null {
  const { root, members } =
    node.type === 'MemberExpression' ? flattenMembers(node) : { root: node, members: [] }
  if (root.type !== 'Identifier') return rejectNode(ctx, node, site)

  const binding = lookup(site.scope, root.name)
  if (!binding) return reportUnresolvedIdentifier(ctx, site.scope, root, site.decl.key, node)

  switch (binding.kind) {
    case 'vars': {
      const first = members[0]
      const name = first ? memberName(first) : null
      if (!first || name === null) {
        return unsupported(
          ctx,
          node,
          'Reference one variable: vars.name.',
          'Write vars.name.',
          site.decl.key
        )
      }
      // Variables are keyed by normalized name; the SDK types `vars` by the key as declared.
      const key = normalizeWorkflowBlockName(name)
      if (!ctx.variables.has(key)) {
        ctx.reporter.report(
          'E_UNKNOWN_VARIABLE',
          `No workflow variable is keyed ${name}.`,
          rangeOf(ctx, first),
          {
            hint: () => didYouMean(key, ctx.variables.keys(), (known) => `vars.${known}`),
            blockKey: site.decl.key,
          }
        )
        return null
      }
      const rest = segmentsOf(ctx, members.slice(1), site)
      if (!rest) return null
      if (site.varNodes && rest.length === 0) return { $sim: 'var', key }
      return `<${formatStoredPath([{ kind: 'name', name: 'variable' }, { kind: 'name', name: key }, ...rest])}>`
    }
    case 'sdk': {
      if (binding.name !== 'env') {
        return unsupported(
          ctx,
          node,
          `${root.name} is an SDK function; call it.`,
          HINTS.calls,
          site.decl.key
        )
      }
      const first = members[0]
      const name = first ? memberName(first) : null
      if (!first || name === null || !ENV_VAR_NAME.test(name)) {
        ctx.reporter.report(
          'E_INVALID_ENV_NAME',
          'Environment variable names match [A-Za-z_][A-Za-z0-9_]*.',
          rangeOf(ctx, first ?? node),
          { hint: 'Write env.NAME with a valid name.', blockKey: site.decl.key }
        )
        return null
      }
      if (members.length > 1) {
        return unsupported(
          ctx,
          members[1],
          'env.NAME is a whole value.',
          'Remove the member access.',
          site.decl.key
        )
      }
      checkEnvName(ctx, name, rangeOf(ctx, first), site.decl.key)
      return `{{${name}}}`
    }
    case 'subflowScope':
      return subflowScopeRef(ctx, node, binding.container, members, site)
    case 'block': {
      const target = binding.decl
      const segments = segmentsOf(ctx, members, site)
      if (!segments) return null
      checkOutputPath(ctx, rangeOf(ctx, node), target, segments, site.decl.key)
      if (target.order > site.decl.order && target !== site.decl) {
        ctx.reporter.report(
          'W_FORWARD_REF',
          `${target.ident ?? target.key} is declared after this block.`,
          rangeOf(ctx, node),
          { hint: 'Declare blocks before the blocks that read them.', blockKey: site.decl.key }
        )
      }
      return blockRefToken(
        ctx,
        node,
        target,
        [{ kind: 'name', name: target.key }, ...segments],
        site
      )
    }
  }
}

/** A key holding a bracket splits at it: the runtime reads `<ab[0].data>` as block `ab`. */
const BRACKET = /[[\]]/

/**
 * The `<key.path>` token for a reference whose head is `target`'s key, or `null` after
 * `E_REF_UNREPRESENTABLE` when the runtime would not read the token as one reference to it: a
 * key holding an operator character (`q&a`) reads as text, `>` ends the token early (`x>y`), and
 * a bracket splits the head (`ab[0]`).
 */
function blockRefToken(
  ctx: CompileContext,
  node: Node,
  target: BlockDecl,
  path: RefSegment[],
  site: ValueSite
): string | null {
  const token = `<${formatStoredPath(path)}>`
  const [found, ...more] = findWorkflowReferenceTokens(token)
  if (!BRACKET.test(target.key) && more.length === 0 && found?.value === token) return token
  ctx.reporter.report(
    'E_REF_UNREPRESENTABLE',
    `${target.name} is keyed ${target.key}, which a reference cannot name: ${token} would not resolve to it at run time.`,
    rangeOf(ctx, node),
    {
      hint: 'Rename the block without any of < > = + * / ! & | [ ].',
      blockKey: site.decl.key,
    }
  )
  return null
}

function segmentsOf(
  ctx: CompileContext,
  members: MemberExpression[],
  site: ValueSite
): RefSegment[] | null {
  const segments: RefSegment[] = []
  for (const member of members) {
    const segment = compileMemberSegment(ctx, member, site)
    if (!segment) return null
    segments.push(segment)
  }
  return segments
}

/**
 * Records `name` as read, and reports `W_ENV_UNKNOWN` when the caller's runs resolve a known set of
 * env names and `name` is not one. Names a file declares (`envDeclaredIn`, an offline check) say
 * only what that file lists, not what the workspace holds, so the finding says that instead.
 */
function checkEnvName(ctx: CompileContext, name: string, at: Range, blockKey: BlockKey): void {
  ctx.envReferences.add(name)
  const envNames = ctx.envNames
  if (!envNames || envNames.has(name)) return
  ctx.reporter.report(
    'W_ENV_UNKNOWN',
    ctx.envDeclaredIn
      ? `${ctx.envDeclaredIn} does not declare ${name}. This check is offline, so it cannot tell whether the workspace holds a value for it; the dry run checks.`
      : `The workspace has no env variable ${name}, so it resolves to nothing at run time.`,
    at,
    {
      hint: () => {
        const near = didYouMean(name, envNames)
        return ctx.envDeclaredIn
          ? `${near ? `${near} Otherwise d` : 'D'}eclare ${name} in ${ctx.envDeclaredIn} and set its value with \`sim secrets set ${name} --scope workspace\`.`
          : (near ??
              `Add ${name} under the workspace's or your environment variables, or use a name .sim/sdk/workspace.d.ts lists.`)
      },
      blockKey,
    }
  )
}

function checkOutputPath(
  ctx: CompileContext,
  at: Range,
  target: BlockDecl,
  segments: RefSegment[],
  blockKey: BlockKey
): void {
  if (segments.length === 0) return
  const containerKind = containerKindOf(target)
  if (containerKind) {
    const first = segments[0]
    const known = [
      ...CONTAINER_OUTPUTS,
      ...(containerKind === 'loop' ? LOOP_PROPERTIES : PARALLEL_PROPERTIES),
    ]
    if (first.kind === 'name' && !known.includes(first.name)) {
      ctx.reporter.report(
        'W_UNKNOWN_OUTPUT_PATH',
        `A ${containerKind} has no output ${first.name}.`,
        at,
        { hint: () => didYouMean(first.name, known), blockKey }
      )
    }
    if (first.kind === 'name') checkIterationScope(ctx, at, blockKey, target, first.name)
    return
  }
  const block = catalogBlockOf(target)
  const dynamicSource = block?.dynamicOutputs?.source
  if (
    dynamicSource === 'responseFormat' ||
    (dynamicSource === 'inputFormat' && block && DECLARED_INPUT_TRIGGERS.has(block.type))
  ) {
    ctx.dynamicOutputRefs.push({ at, target, segments, blockKey })
    return
  }
  // Table rows only refine the element type of `rows`/`row`; the outputs themselves are static.
  if (!block || (block.dynamicOutputs && block.dynamicOutputs.source !== 'tableRows')) return
  const builder = target.builder.kind === 'catalog' ? target.builder.builder : undefined
  const outputs = builderOutputSchemas(ctx.catalog, block, builder)
  if (outputKnown(outputs, segments)) return
  if (isErrorOutput(segments)) {
    ctx.errorOutputRefs.push({ at, target, blockKey })
    return
  }
  ctx.reporter.report(
    'W_UNKNOWN_OUTPUT_PATH',
    `${target.name} has no output ${formatStoredPath(segments)}.`,
    at,
    { hint: () => unknownOutputHint(outputs, segments), blockKey }
  )
}

/**
 * `x.error`: the message a failed block outputs when an error edge (`x.onError(y)`) leaves it,
 * which the executor returns as the block's output instead of failing the run
 * (`BlockExecutor`'s `errorOutput`). Any other block fails the run, so nothing reads it.
 */
function isErrorOutput(segments: RefSegment[]): boolean {
  return segments.length === 1 && segments[0].kind === 'name' && segments[0].name === 'error'
}

/**
 * Checks each `x.error` reference once the edges are known: `x` must have an error edge
 * (`x.onError(...)`), else the path reads nothing (`W_OUTPUT_PATH_UNDECLARED`).
 */
export function checkErrorOutputRefs(ctx: CompileContext, erroring: ReadonlySet<BlockKey>): void {
  for (const { at, target, blockKey } of ctx.errorOutputRefs) {
    if (erroring.has(target.key)) continue
    ctx.reporter.report(
      'W_OUTPUT_PATH_UNDECLARED',
      `${target.name} has no output error: only a block with an error edge outputs its failure message.`,
      at,
      {
        hint: `Wire ${target.ident ?? 'the block'}.onError(<handler>) and read ${target.ident ?? 'it'}.error in the handler.`,
        blockKey,
      }
    )
  }
}

/**
 * The input triggers whose outputs are exactly their declared inputs plus static outputs, as the
 * editor's tag picker lists them (`getEffectiveBlockOutputs`). The legacy starter's outputs
 * depend on its mode, so it is left out.
 */
const DECLARED_INPUT_TRIGGERS: ReadonlySet<string> = new Set([
  'start_trigger',
  'api_trigger',
  'input_trigger',
])

/** The unified Start's run-metadata output, present while its `runMetadata` switch is on. */
const START_RUN_METADATA = 'metadata'

/**
 * The output fields a block's dynamic-outputs param declares: an agent's `responseFormat` fields,
 * or an input trigger's `inputFormat` inputs (plus the unified Start's `metadata` while run
 * metadata is on). `null` when the param cannot be read statically.
 */
function declaredOutputFields(
  source: 'responseFormat' | 'inputFormat',
  compiled: CanonicalBlock,
  param: string
): string[] | null {
  if (source === 'responseFormat') return responseFormatFields(getOwn(compiled.params, param))
  const inputs = inputFormatFields(getOwn(compiled.params, param))
  if (inputs === null) return null
  const names = inputs.map((input) => input.name)
  const metadata = getOwn(compiled.params, 'runMetadata')
  return metadata?.kind === 'value' && metadata.value === true
    ? [...names, START_RUN_METADATA]
    : names
}

/**
 * Checks each reference into a block whose outputs a param declares (an agent's
 * `responseFormat`, an input trigger's `inputFormat`), once every block is compiled: the first
 * path segment must be a declared field or one of the block's static outputs
 * (`W_UNKNOWN_OUTPUT_PATH` otherwise, `W_OUTPUT_PATH_UNDECLARED` for an input trigger: a caller
 * may still pass an undeclared input, which the unified Start passes through). A param the compiler
 * cannot read (not JSON, or holding references) leaves every path allowed; an absent one leaves
 * the static outputs.
 */
export function checkDynamicOutputRefs(
  ctx: CompileContext,
  blockOf: (key: BlockKey) => CanonicalBlock | undefined
): void {
  for (const { at, target, segments, blockKey } of ctx.dynamicOutputRefs) {
    const block = catalogBlockOf(target)
    const compiled = blockOf(target.key)
    const dynamic = block?.dynamicOutputs
    if (!block || !compiled || !dynamic) continue
    if (dynamic.source !== 'responseFormat' && dynamic.source !== 'inputFormat') continue
    const fields = declaredOutputFields(dynamic.source, compiled, dynamic.param)
    const [first] = segments
    if (fields === null || first?.kind !== 'name' || fields.includes(first.name)) continue
    const builder = target.builder.kind === 'catalog' ? target.builder.builder : undefined
    const outputs = builderOutputSchemas(ctx.catalog, block, builder)
    if (outputKnown(outputs, segments)) continue
    if (isErrorOutput(segments)) {
      ctx.errorOutputRefs.push({ at, target, blockKey })
      continue
    }
    const known = [...fields, ...Object.keys(outputs)]
    const path = formatStoredPath(segments)
    if (dynamic.source === 'inputFormat') {
      ctx.reporter.report(
        'W_OUTPUT_PATH_UNDECLARED',
        fields.length > 0
          ? `${target.name} declares no input ${first.name}: its inputFormat declares ${fields.join(', ')}.`
          : `${target.name} declares no input ${first.name}: its inputFormat declares none.`,
        at,
        {
          hint: () =>
            didYouMean(first.name, known) ??
            `Add ${first.name} to ${target.ident ?? target.name}'s inputFormat, or reference an input it declares.`,
          blockKey,
        }
      )
      continue
    }
    ctx.reporter.report(
      'W_UNKNOWN_OUTPUT_PATH',
      fields.length > 0
        ? `${target.name} has no output ${path}: its responseFormat declares ${fields.join(', ')}.`
        : `${target.name} has no output ${path}, and declares no responseFormat field of that name.`,
      at,
      {
        hint: () =>
          didYouMean(first.name, known) ??
          `Add ${first.name} to the responseFormat schema's properties, or reference a field it declares.`,
        blockKey,
      }
    )
  }
}

/**
 * Checks the `$ref` chains and `$env` names read from JavaScript code files once every block is
 * declared. An env name the workspace lacks is `W_ENV_UNKNOWN`, as in the workflow file. A `$ref` head
 * that names no block (a block's ident, a renamed block's old key, a typo) or a variable that does
 * not exist is `W_UNRESOLVED_REF`, and a path no output has is `W_UNKNOWN_OUTPUT_PATH`. Warnings,
 * not errors, because stored code may already hold a dangling reference and must round-trip; at
 * run time such a token is spliced into the code as text, which fails as JavaScript, so the apply
 * and an offline check refuse `W_UNRESOLVED_REF` as `E_APPLY_UNRESOLVED_REF` on code the edit
 * changed. A head that
 * is the stored key of a block the source renamed (`renamed`, stored key → source key) resolves:
 * an apply rewrites it to the new key, so its path is checked against the renamed block.
 */
export function checkCodeFileRefs(
  ctx: CompileContext,
  renamed: ReadonlyMap<BlockKey, BlockKey>
): void {
  checkSharedCodeFileScopes(ctx, renamed)
  for (const { path, blockKey, refs } of ctx.codeFiles.chains) {
    for (const ref of refs) {
      const at: Range = { file: path, start: ref.start, end: ref.end }
      if (ref.kind === 'env') {
        checkEnvName(ctx, ref.name, at, blockKey)
        continue
      }
      const [head, ...rest] = ref.segments
      if (head?.kind !== 'name') continue
      /** The reference as the file writes it: a `$ref` chain, or a `<key.path>` tag. */
      const spell = (segments: RefSegment[]) =>
        ref.tag ? `<${formatStoredPath(segments)}>` : formatMemberPath(REF_ROOT, segments)
      const written = spell(ref.segments)
      if (head.name === 'variable') {
        const name = rest[0]?.kind === 'name' ? rest[0].name : null
        if (name !== null && !ctx.variables.has(name)) {
          ctx.reporter.report(
            'W_UNRESOLVED_REF',
            `${written}: no workflow variable is keyed ${name}.`,
            at,
            {
              hint: () =>
                didYouMean(name, ctx.variables.keys(), (key) =>
                  spell([head, { kind: 'name', name: key }])
                ),
              blockKey,
            }
          )
        }
        continue
      }
      if (isReservedWorkflowBlockName(head.name)) {
        checkIterationTag(ctx, at, blockKey, ref.segments)
        continue
      }
      const renamedTo = renamed.get(head.name)
      const target =
        ctx.declsByKey.get(head.name) ??
        (renamedTo === undefined ? undefined : ctx.declsByKey.get(renamedTo))
      if (target) {
        checkOutputPath(ctx, at, target, rest, blockKey)
        continue
      }
      const byIdent = ctx.declsByIdent.get(head.name)?.[0]
      const byName = ctx.declsByKey.get(normalizeWorkflowBlockName(head.name))
      const suggested = byIdent ?? byName
      const rewritten = (key: BlockKey) => spell([{ kind: 'name', name: key }, ...rest])
      ctx.reporter.report(
        'W_UNRESOLVED_REF',
        `${written} names no block, so it does not resolve at run time.`,
        at,
        {
          hint: suggested
            ? `${ref.tag ? 'A tag' : REF_ROOT} names a block by its key: write ${rewritten(suggested.key)}.`
            : ctx.knownKeys.has(head.name)
              ? () => formerBlockHint(ctx, head.name, renamed, rewritten, spell)
              : () =>
                  didYouMean(head.name, ctx.declsByKey.keys(), (key) =>
                    spell([{ kind: 'name', name: key }])
                  ),
          blockKey,
        }
      )
    }
  }
}

/**
 * `W_REF_OUT_OF_SCOPE` for an iteration field a shared code file reads, for each block after the
 * first that runs it (`sharedReads`): whether the read is in scope depends on where the block
 * sits, which {@link checkCodeFileRefs} checked only for the first.
 */
function checkSharedCodeFileScopes(
  ctx: CompileContext,
  renamed: ReadonlyMap<BlockKey, BlockKey>
): void {
  const refsByPath = new Map(ctx.codeFiles.chains.map(({ path, refs }) => [path, refs]))
  for (const { path, blockKey } of ctx.codeFiles.sharedReads) {
    for (const ref of refsByPath.get(path) ?? []) {
      if (ref.kind === 'env') continue
      const at: Range = { file: path, start: ref.start, end: ref.end }
      const [head, property] = ref.segments
      if (head?.kind !== 'name' || property?.kind !== 'name') continue
      if (isReservedWorkflowBlockName(head.name)) {
        checkIterationTag(ctx, at, blockKey, ref.segments)
        continue
      }
      const renamedTo = renamed.get(head.name)
      const target =
        ctx.declsByKey.get(head.name) ??
        (renamedTo === undefined ? undefined : ctx.declsByKey.get(renamedTo))
      if (target && containerKindOf(target)) {
        checkIterationScope(ctx, at, blockKey, target, property.name)
      }
    }
  }
}

/**
 * The hint for a code file reference whose head is the key of a block the workflow had (the lock
 * or the stored workflow binds it) and source no longer declares: most often a block renamed in
 * both name and const, whose references an apply rewrites only when it ties the block to the
 * stored one. Names the one declared block nothing binds, when there is exactly one, as the
 * probable new key (`rewritten` writes the reference with it; `spell` writes a reference path as
 * the file does).
 */
function formerBlockHint(
  ctx: CompileContext,
  formerKey: BlockKey,
  renamed: ReadonlyMap<BlockKey, BlockKey>,
  rewritten: (key: BlockKey) => string,
  spell: (segments: RefSegment[]) => string
): string {
  const renamedTo = new Set(renamed.values())
  const unbound = [...ctx.declsByKey.values()].filter(
    (decl) => !ctx.knownKeys.has(decl.key) && !renamedTo.has(decl.key)
  )
  const lead = `${spell([{ kind: 'name', name: formerKey }])} is a block this workflow had that ${SOURCE_ENTRY_FILE} no longer declares under that key`
  const [only] = unbound
  return unbound.length === 1 && only
    ? `${lead}: if it was renamed to ${only.name}, an apply that keeps its id rewrites this reference to ${rewritten(only.key)}, so no edit is needed.`
    : `${lead}: if you renamed it, write ${spell([{ kind: 'name', name: 'newkey' }])}, where newkey is its display name lowercased with whitespace and dots removed.`
}

function subflowScopeRef(
  ctx: CompileContext,
  node: Node,
  container: BlockDecl,
  members: MemberExpression[],
  site: ValueSite
): string | null {
  const kind = containerKindOf(container) ?? 'loop'
  const known = kind === 'loop' ? LOOP_PROPERTIES : PARALLEL_PROPERTIES
  const first = members[0]
  const property = first ? memberName(first) : null
  const paramName = node.type === 'MemberExpression' ? flattenMembers(node).root : node
  const label = paramName.type === 'Identifier' ? paramName.name : 'p'
  if (!first || property === null || !known.includes(property)) {
    ctx.reporter.report(
      'E_UNKNOWN_SUBFLOW_PROPERTY',
      `A ${kind} has no property ${property ?? '(none)'}.`,
      rangeOf(ctx, node),
      {
        hint: didYouMean(property ?? '', known, (name) => `${label}.${name}`),
        blockKey: site.decl.key,
      }
    )
    return null
  }
  const rest = segmentsOf(ctx, members.slice(1), site)
  if (!rest) return null
  const innermostOfKind = enclosingContainers(site.decl).find(
    (decl) => containerKindOf(decl) === kind
  )
  const path: RefSegment[] = [{ kind: 'name', name: property }, ...rest]
  if (innermostOfKind === container) {
    return `<${formatStoredPath([{ kind: 'name', name: kind }, ...path])}>`
  }
  return blockRefToken(ctx, node, container, [{ kind: 'name', name: container.key }, ...path], site)
}

function templateText(
  ctx: CompileContext,
  node: TaggedTemplateExpression,
  site: ValueSite
): string | null {
  const { quasis, expressions } = node.quasi
  let text = ''
  for (const [index, quasi] of quasis.entries()) {
    const cooked = quasi.value.cooked
    if (cooked == null) {
      return unsupported(
        ctx,
        quasi,
        'This template has an invalid escape sequence.',
        'Escape the backslash: \\\\.',
        site.decl.key
      )
    }
    checkLiteralRefs(ctx, quasi, cooked, site)
    text += cooked
    const expression = expressions[index]
    if (!expression) continue
    if (expression.type === 'StringLiteral') {
      text += expression.value
    } else if (expression.type === 'NumericLiteral') {
      text += String(expression.value)
    } else if (
      expression.type === 'CallExpression' &&
      sdkCallPath(site.scope, expression) === 'ref'
    ) {
      const raw = singleStringArgument(ctx, expression, 'ref', site)
      if (!raw) return null
      text += `<${raw.text}>`
    } else if (expression.type === 'Identifier' || expression.type === 'MemberExpression') {
      const ref = compileRef(ctx, expression, { ...site, varNodes: false })
      if (ref === null || typeof ref !== 'string') return null
      text += ref
    } else {
      return rejectNode(ctx, expression, site)
    }
  }
  return text
}

function compileCall(
  ctx: CompileContext,
  call: CallExpression,
  site: ValueSite
): CompiledValue | null {
  const path = sdkCallPath(site.scope, call)
  if (path === null) return rejectNode(ctx, call, site)
  const resourceKind = RESOURCE_KIND_BY_CALL.get(path)
  if (resourceKind) {
    const argument = singleStringArgument(ctx, call, path, site)
    if (!argument) return null
    const value: Value = { $sim: 'resource', kind: resourceKind, key: argument.text }
    return { kind: 'value', value, form: path === 'file' ? 'file' : 'resource' }
  }
  switch (path) {
    case 'ref': {
      const argument = singleStringArgument(ctx, call, 'ref', site)
      return argument ? { kind: 'value', value: `<${argument.text}>`, form: 'ref' } : null
    }
    case 'codeFile': {
      const argument = singleStringArgument(ctx, call, 'codeFile', site)
      return argument ? { kind: 'codeFile', path: argument.text, pathNode: argument.node } : null
    }
    case 'todo':
      if (call.arguments.length > 0)
        return unsupported(ctx, call, 'todo() takes no arguments.', 'Write todo().', site.decl.key)
      return { kind: 'todo' }
    case 'stored':
      if (call.arguments.length > 0)
        return unsupported(
          ctx,
          call,
          'stored() takes no arguments.',
          'Write stored().',
          site.decl.key
        )
      return { kind: 'stored' }
    case 'raw': {
      const [argument, ...extra] = call.arguments
      if (!argument || extra.length > 0 || argument.type === 'SpreadElement') {
        return unsupported(
          ctx,
          call,
          'raw() takes one literal.',
          'Write raw(value).',
          site.decl.key
        )
      }
      const value = rawLiteral(ctx, argument, site)
      return value === undefined ? null : { kind: 'value', value, form: 'raw' }
    }
    default:
      return unsupported(ctx, call, `${path}() is not a value.`, valueCallHint(path), site.decl.key)
  }
}

/** The hint for an SDK call written where a value goes that is not a value call. */
function valueCallHint(path: string): string {
  if (isTemplateTag(path)) return `Use ${path}\`...\` as a tagged template.`
  if (path === 'edge') return 'edge(...) is wiring; write it as its own statement.'
  if (path === 'env') return 'Write env.NAME.'
  return HINTS.bindInline
}

function compileArray(
  ctx: CompileContext,
  node: ArrayExpression,
  site: ValueSite
): { items: Value[]; selector: boolean } | null {
  const items: Value[] = []
  let selector = node.elements.length > 0
  for (const element of node.elements) {
    if (!element)
      return unsupported(
        ctx,
        node,
        'Array holes are not values.',
        'Write each element explicitly.',
        site.decl.key
      )
    if (element.type === 'SpreadElement') return rejectNode(ctx, element, site)
    const compiled = compileValue(ctx, element, site)
    const item = compiled ? nestedValue(ctx, element, compiled, site) : undefined
    if (item === undefined) return null
    if (compiled?.kind !== 'value' || !isSelectorForm(compiled.form)) selector = false
    items.push(item)
  }
  return { items, selector }
}

function compileObject(ctx: CompileContext, node: ObjectExpression, site: ValueSite): Value | null {
  const result: Record<string, Value> = {}
  const entries = objectEntries(ctx, node)
  let failed = entries.length !== node.properties.length
  for (const [key, property] of entries) {
    const value = compileNested(ctx, property.value, site)
    if (value === undefined) {
      failed = true
      continue
    }
    setOwn(result, key, value)
  }
  if (failed) return null
  if (Object.hasOwn(result, '$sim')) {
    const stored: Record<string, Json> = {}
    let plain = true
    for (const [key, entry] of Object.entries(result)) {
      const json = toStoredJson(entry)
      if (json === null && entry !== null) plain = false
      setOwn(stored, key, json)
    }
    if (!plain) {
      return unsupported(
        ctx,
        node,
        'An object with a $sim key must hold plain data.',
        'Write the canonical value with raw(...).',
        site.decl.key
      )
    }
    return { $sim: 'literal', value: stored }
  }
  return result
}

/** A value nested inside an object or array; `undefined` after reporting an error. */
export function compileNested(ctx: CompileContext, node: Node, site: ValueSite): Value | undefined {
  const compiled = compileValue(ctx, node, site)
  return compiled ? nestedValue(ctx, node, compiled, site) : undefined
}

/** Narrows an already compiled value to a plain nested `Value` (`absent` is `null`); `undefined` after reporting an error. */
export function nestedValue(
  ctx: CompileContext,
  node: Node,
  compiled: CompiledValue,
  site: ValueSite
): Value | undefined {
  if (compiled.kind === 'value') return compiled.value
  if (compiled.kind === 'absent') return null
  if (compiled.kind === 'codeFile') {
    unsupported(
      ctx,
      node,
      'codeFile() holds a whole code param.',
      "Write code: codeFile('./functions/x.js').",
      site.decl.key
    )
    return undefined
  }
  const name = compiled.kind === 'todo' ? 'todo()' : 'stored()'
  unsupported(
    ctx,
    node,
    `${name} stands for a whole param.`,
    `Write ${name} as the param value.`,
    site.decl.key
  )
  return undefined
}

/**
 * Statically evaluates one value expression. Nothing runs: only literal
 * syntax, SDK value calls and references are understood; anything else is reported with the hint
 * from the s3 rejection table and yields `null`.
 */
export function compileValue(
  ctx: CompileContext,
  node: Node,
  site: ValueSite
): CompiledValue | null {
  switch (node.type) {
    case 'StringLiteral':
      checkLiteralRefs(ctx, node, node.value, site)
      return { kind: 'value', value: node.value, form: 'literal' }
    case 'BooleanLiteral':
      return { kind: 'value', value: node.value, form: 'literal' }
    case 'NumericLiteral':
      return { kind: 'value', value: node.value, form: 'literal' }
    case 'NullLiteral':
      return { kind: 'absent' }
    case 'UnaryExpression':
      if (node.operator === '-' && node.argument.type === 'NumericLiteral') {
        return { kind: 'value', value: -node.argument.value, form: 'literal' }
      }
      return rejectNode(ctx, node, site)
    case 'TemplateLiteral': {
      const text = literalText(node)
      if (text === null) {
        return node.expressions.length > 0
          ? rejectNode(ctx, node, site)
          : unsupported(
              ctx,
              node,
              'This template has an invalid escape sequence.',
              'Escape the backslash: \\\\.',
              site.decl.key
            )
      }
      checkLiteralRefs(ctx, node, text, site)
      return { kind: 'value', value: text, form: 'literal' }
    }
    case 'TaggedTemplateExpression': {
      const tag = node.tag.type === 'Identifier' ? lookup(site.scope, node.tag.name) : null
      if (!tag && node.tag.type === 'Identifier' && isTemplateTag(node.tag.name)) {
        return reportNotImported(
          ctx,
          'E_UNKNOWN_IDENTIFIER',
          node.tag.name,
          node.tag,
          site.decl.key
        )
      }
      if (!tag || tag.kind !== 'sdk' || !isTemplateTag(tag.name)) return rejectNode(ctx, node, site)
      const text = templateText(ctx, node, site)
      return text === null ? null : { kind: 'value', value: text, form: 'template' }
    }
    case 'Identifier':
    case 'MemberExpression': {
      const text = compileRef(ctx, node, site)
      return text === null ? null : { kind: 'value', value: text, form: 'ref' }
    }
    case 'CallExpression':
      return compileCall(ctx, node, site)
    case 'ArrayExpression': {
      const array = compileArray(ctx, node, site)
      if (array === null) return null
      return { kind: 'value', value: array.items, form: array.selector ? 'resource' : 'literal' }
    }
    case 'ObjectExpression': {
      const value = compileObject(ctx, node, site)
      return value === null ? null : { kind: 'value', value, form: 'literal' }
    }
    default:
      return rejectNode(ctx, node, site)
  }
}

/**
 * Writes a JSON code field given as an object or array literal: its JSON text goes in
 * `params[id]`, and the field is queued in `ctx.jsonFields` so its typed references are written
 * once every block is compiled. Returns the text, or `undefined` after reporting an error.
 */
export function compileJsonField(
  ctx: CompileContext,
  node: Node,
  site: ValueSite,
  params: Record<SubBlockId, CanonicalParam>,
  id: SubBlockId
): string | undefined {
  const refs: JsonFieldEntry['refs'] = []
  const tree = compileJsonTree(ctx, node, site, refs)
  if (tree === undefined) return undefined
  const value = jsonFieldText(tree, () => true)
  setOwn(params, id, { kind: 'value', value })
  ctx.jsonFields.push({ params, id, tree, refs })
  return value
}

/**
 * A JSON code field written as an object or array literal (`json-fields.ts`): a bare reference is
 * a typed leaf whose stored form follows its output type; every other leaf compiles as a value,
 * so a template is a JSON string. `undefined` after reporting an error.
 */
function compileJsonTree(
  ctx: CompileContext,
  node: Node,
  site: ValueSite,
  refs: JsonFieldEntry['refs']
): JsonTree | undefined {
  if (node.type === 'ObjectExpression') {
    const result: { [key: string]: JsonTree } = {}
    const entries = objectEntries(ctx, node)
    let failed = entries.length !== node.properties.length
    for (const [key, property] of entries) {
      const tree = compileJsonTree(ctx, property.value, site, refs)
      if (tree === undefined) failed = true
      else setOwn(result, key, tree)
    }
    return failed ? undefined : result
  }
  if (node.type === 'ArrayExpression') {
    const items: JsonTree[] = []
    for (const element of node.elements) {
      if (!element || element.type === 'SpreadElement') {
        unsupported(
          ctx,
          element ?? node,
          'Write each element explicitly.',
          HINTS.spread,
          site.decl.key
        )
        return undefined
      }
      const tree = compileJsonTree(ctx, element, site, refs)
      if (tree === undefined) return undefined
      items.push(tree)
    }
    return items
  }
  if (node.type === 'Identifier' || node.type === 'MemberExpression') {
    const ref = compileRef(ctx, node, { ...site, varNodes: false })
    if (typeof ref !== 'string') return undefined
    refs.push({ token: ref, range: rangeOf(ctx, node), blockKey: site.decl.key })
    return new JsonRef(ref, false)
  }
  const value = compileNested(ctx, node, site)
  if (value === undefined) return undefined
  const tree = valueTree(value)
  if (tree === undefined) {
    unsupported(
      ctx,
      node,
      'A JSON field literal holds data; a resource or canonical node is not data.',
      'Write a string, number, boolean, null, array or object here.',
      site.decl.key
    )
  }
  return tree
}
