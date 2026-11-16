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
import { WORKFLOW_RESOURCE_KINDS } from '@sim/workflow-types/resources'
import type { CatalogOutput } from '../catalog/types'
import {
  ENV_VAR_NAME,
  formatStoredPath,
  isIndexSegment,
  isNameSegment,
  type RefSegment,
} from '../code-files/ref-path'
import type { Json, ResourceKind, Value, VarNode } from '../model'
import { setOwn } from '../records'
import {
  type BlockDecl,
  type CompileContext,
  catalogBlockOf,
  containerKindOf,
  enclosingContainers,
  lookup,
  rangeOf,
  type Scope,
  visibleNames,
} from './context'
import { didYouMean, HINTS, hintForNode } from './hints'
import { outputSchemasFor } from './validate-catalog'

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
 * How a value was written, which picks the member of a basic/advanced pair (build-spec
 * decision 7) and decides whether `W_VALUE_KIND` applies (only to literals).
 */
type ValueForm = 'literal' | 'ref' | 'template' | 'resource' | 'picked' | 'upload' | 'raw'

export type CompiledValue =
  | { kind: 'value'; value: Value; form: ValueForm }
  /** `todo()`: compiles to absent. */
  | { kind: 'todo' }
  /** `null` at the top of a param: a stored `null` is absent. */
  | { kind: 'absent' }
  /** `file('./x.js')`: only valid as a function block's code. */
  | { kind: 'file'; path: string; pathNode: Node }

const SELECTOR_FORMS: ReadonlySet<ValueForm> = new Set(['resource', 'picked', 'upload'])

export function isSelectorForm(form: ValueForm): boolean {
  return SELECTOR_FORMS.has(form)
}

/** Call-form resource constructors (s2 D6) and the kind each produces. */
const RESOURCE_CALLS: Record<string, ResourceKind> = {
  binding: 'credential',
  table: 'table',
  kb: 'knowledge-base',
  workflow: 'workflow',
  skill: 'skill',
  customTool: 'custom-tool',
  mcp: 'mcp-server',
  sandbox: 'sandbox',
  folder: 'file-folder',
  upload: 'file',
}

const TEMPLATE_TAGS = new Set(['t', 'js', 'json', 'md', 'py', 'sh'])

/** SDK functions that are values, not block builders. */
export const SDK_VALUE_FUNCTIONS = new Set([
  ...Object.keys(RESOURCE_CALLS),
  ...TEMPLATE_TAGS,
  'picked',
  'raw',
  'todo',
  'ref',
  'file',
  'edge',
  'env',
  'vars',
])

const RESOURCE_KINDS: ReadonlySet<string> = new Set<string>([
  ...WORKFLOW_RESOURCE_KINDS.filter((kind) => kind !== 'env-var'),
  'workflow',
])

/** Loop and parallel params (executor/variables/resolvers/loop.ts:44, parallel.ts:45). */
const LOOP_PROPERTIES = ['index', 'currentItem', 'items', 'iteration', 'item']
const PARALLEL_PROPERTIES = ['index', 'currentItem', 'items']
/** Named-form container outputs (loop.ts:43, parallel.ts:44). */
const CONTAINER_OUTPUTS = ['results', 'result']

function report(
  ctx: CompileContext,
  node: Node,
  message: string,
  hint: string | undefined,
  site?: ValueSite
): null {
  ctx.reporter.report('E_UNSUPPORTED_SYNTAX', message, rangeOf(ctx, node), {
    ...(hint !== undefined && { hint }),
    ...(site && { blockKey: site.decl.key }),
  })
  return null
}

function rejectNode(ctx: CompileContext, node: Node, site?: ValueSite): null {
  return report(
    ctx,
    node,
    `${node.type} is not supported in a workflow file.`,
    hintForNode(node),
    site
  )
}

/** The literal text of a property key, or `null` (after reporting) for a computed key. */
export function propertyKey(ctx: CompileContext, property: ObjectProperty): string | null {
  if (property.computed) {
    report(ctx, property, 'Computed keys are not supported.', HINTS.computedKey)
    return null
  }
  const key = property.key
  if (key.type === 'Identifier') return key.name
  if (key.type === 'StringLiteral') return key.value
  if (key.type === 'NumericLiteral') return String(key.value)
  report(ctx, property, 'Use an identifier or string key.', HINTS.computedKey)
  return null
}

/**
 * The properties of an object literal as `[key, property]`, rejecting methods, getters, spreads,
 * computed keys and duplicate keys. `null` means the object itself was rejected.
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
      else report(ctx, property, `The key ${key} is written twice.`, HINTS.duplicateKey)
      continue
    }
    seen.add(key)
    entries.push([key, property])
  }
  return entries
}

/** A string literal, or a template literal with no `${}`; `null` otherwise. */
export function literalText(node: Node): string | null {
  if (node.type === 'StringLiteral') return node.value
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked ?? null
  }
  return null
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
        only('$sim', 'kind', 'key') &&
        typeof value.kind === 'string' &&
        RESOURCE_KINDS.has(value.kind) &&
        typeof value.key === 'string'
      )
    case 'unresolved':
      return (
        only('$sim', 'kind', 'id') && typeof value.kind === 'string' && typeof value.id === 'string'
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

/** A literal-only tree (strings, numbers, booleans, null, arrays, objects) as plain JSON. */
function literalTree(ctx: CompileContext, node: Node, site?: ValueSite): Json | undefined {
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
        report(ctx, node, 'Write literals only here.', HINTS.untaggedTemplate, site)
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
          report(ctx, element ?? node, 'Write each element explicitly.', HINTS.spread, site)
          return undefined
        }
        const item = literalTree(ctx, element, site)
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
        const item = literalTree(ctx, property.value, site)
        if (item === undefined) return undefined
        setOwn(result, key, item)
      }
      return result
    }
    default:
      report(ctx, node, 'Write literals only here.', 'Write the stored value as a literal.', site)
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
  const value = literalTree(ctx, node, site)
  if (value === undefined) return undefined
  if (!canonicalNodesValid(value)) {
    report(
      ctx,
      node,
      'This $sim object is not a canonical node.',
      "Use { $sim: 'resource', kind, key }, { $sim: 'unresolved', kind, id }, { $sim: 'var', key }, { $sim: 'csv', items } or { $sim: 'literal', value }.",
      site
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
    return report(ctx, call, `${name}() takes one string literal.`, `Write ${name}('key').`, site)
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

function memberSegment(
  ctx: CompileContext,
  member: MemberExpression,
  site: ValueSite
): RefSegment | null {
  const property = member.property
  if (!member.computed) {
    if (property.type === 'Identifier' && isNameSegment(property.name)) {
      return { kind: 'name', name: property.name }
    }
    return rejectNode(ctx, member, site)
  }
  if (property.type === 'StringLiteral') {
    if (isNameSegment(property.value)) return { kind: 'name', name: property.value }
    return report(
      ctx,
      property,
      `The path segment '${property.value}' cannot be written as a reference.`,
      "Use ref('block.path') for this spelling.",
      site
    )
  }
  if (property.type === 'NumericLiteral' && isIndexSegment(property.value)) {
    return { kind: 'index', index: property.value }
  }
  return report(ctx, member, 'Element access needs a literal key.', HINTS.elementAccess, site)
}

function memberName(member: MemberExpression): string | null {
  const property = member.property
  if (!member.computed && property.type === 'Identifier') return property.name
  if (member.computed && property.type === 'StringLiteral') return property.value
  return null
}

function outputKnown(outputs: Record<string, CatalogOutput>, segments: RefSegment[]): boolean {
  let level: Record<string, CatalogOutput> | undefined = outputs
  for (const segment of segments) {
    if (!level) return true
    if (segment.kind === 'index') return true
    const output: CatalogOutput | undefined = Object.hasOwn(level, segment.name)
      ? level[segment.name]
      : undefined
    if (!output) return false
    if (!output.properties) return true
    level = output.properties
  }
  return true
}

/**
 * Compiles an identifier or member chain to its stored token text (build-spec decision 8, s3 §4
 * "Ref mapping"): a block chain to `<key.path>`, `vars.x` to `<variable.x>`, `env.X` to `{{X}}`,
 * a loop param to `<loop.prop>` (innermost loop of its kind) or `<key.prop>` (named form).
 */
function compileRef(ctx: CompileContext, node: Node, site: ValueSite): string | VarNode | null {
  const { root, members } =
    node.type === 'MemberExpression' ? flattenMembers(node) : { root: node, members: [] }
  if (root.type !== 'Identifier') return rejectNode(ctx, node, site)

  const binding = lookup(site.scope, root.name)
  if (!binding) {
    const elsewhere = ctx.declsByBinding.get(root.name)
    if (elsewhere && elsewhere.length > 0) {
      ctx.reporter.report(
        'E_OUT_OF_SCOPE',
        `${root.name} is declared inside another loop or parallel and is not visible here.`,
        rangeOf(ctx, node),
        {
          hint: 'Wire the subflow and reference its results, or move the block into this scope.',
          blockKey: site.decl.key,
        }
      )
      return null
    }
    ctx.reporter.report(
      'E_UNKNOWN_IDENTIFIER',
      `${root.name} is not defined.`,
      rangeOf(ctx, root),
      {
        ...withHint(didYouMean(root.name, visibleNames(site.scope))),
        blockKey: site.decl.key,
      }
    )
    return null
  }

  switch (binding.kind) {
    case 'vars': {
      const first = members[0]
      const name = first ? memberName(first) : null
      if (!first || name === null) {
        return report(ctx, node, 'Reference one variable: vars.name.', 'Write vars.name.', site)
      }
      if (!ctx.variables.has(name)) {
        ctx.reporter.report(
          'E_UNKNOWN_VARIABLE',
          `No workflow variable is keyed ${name}.`,
          rangeOf(ctx, first),
          {
            ...withHint(didYouMean(name, ctx.variables.keys(), (key) => `vars.${key}`)),
            blockKey: site.decl.key,
          }
        )
        return null
      }
      const rest = segmentsOf(ctx, members.slice(1), site)
      if (!rest) return null
      if (site.varNodes && rest.length === 0) return { $sim: 'var', key: name }
      return `<${formatStoredPath([{ kind: 'name', name: 'variable' }, { kind: 'name', name }, ...rest])}>`
    }
    case 'sdk': {
      if (binding.name !== 'env') {
        return report(ctx, node, `${root.name} is an SDK function; call it.`, HINTS.calls, site)
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
        return report(
          ctx,
          members[1],
          'env.NAME is a whole value.',
          'Remove the member access.',
          site
        )
      }
      return `{{${name}}}`
    }
    case 'loopParam':
      return loopParamRef(ctx, node, binding.container, members, site)
    case 'block': {
      const target = binding.decl
      const segments = segmentsOf(ctx, members, site)
      if (!segments) return null
      checkOutputPath(ctx, node, target, segments, site)
      if (target.order > site.decl.order && target !== site.decl) {
        ctx.reporter.report(
          'W_FORWARD_REF',
          `${target.binding ?? target.key} is declared after this block.`,
          rangeOf(ctx, node),
          { hint: 'Declare blocks before the blocks that read them.', blockKey: site.decl.key }
        )
      }
      return `<${formatStoredPath([{ kind: 'name', name: target.key }, ...segments])}>`
    }
  }
}

function withHint(hint: string | undefined): { hint?: string } {
  return hint === undefined ? {} : { hint }
}

function segmentsOf(
  ctx: CompileContext,
  members: MemberExpression[],
  site: ValueSite
): RefSegment[] | null {
  const segments: RefSegment[] = []
  for (const member of members) {
    const segment = memberSegment(ctx, member, site)
    if (!segment) return null
    segments.push(segment)
  }
  return segments
}

function checkOutputPath(
  ctx: CompileContext,
  node: Node,
  target: BlockDecl,
  segments: RefSegment[],
  site: ValueSite
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
        rangeOf(ctx, node),
        { ...withHint(didYouMean(first.name, known)), blockKey: site.decl.key }
      )
    }
    return
  }
  const block = catalogBlockOf(target)
  if (!block || block.dynamicOutputs) return
  const builder = target.builder.kind === 'catalog' ? target.builder.builder : undefined
  const schemas = outputSchemasFor(ctx.catalog, block, builder)
  if (!schemas.some((outputs) => outputKnown(outputs, segments))) {
    ctx.reporter.report(
      'W_UNKNOWN_OUTPUT_PATH',
      `${block.name} has no output ${formatStoredPath(segments)}.`,
      rangeOf(ctx, node),
      { blockKey: site.decl.key }
    )
  }
}

function loopParamRef(
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
      'E_UNKNOWN_LOOP_PROPERTY',
      property === 'start'
        ? `${label}.start is only for wiring the first block.`
        : `A ${kind} has no property ${property ?? '(none)'}.`,
      rangeOf(ctx, node),
      {
        ...withHint(
          property === 'start'
            ? `Write ${label}.start.to(block).`
            : didYouMean(property ?? '', known, (name) => `${label}.${name}`)
        ),
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
  const head = innermostOfKind === container ? kind : container.key
  return `<${formatStoredPath([{ kind: 'name', name: head }, { kind: 'name', name: property }, ...rest])}>`
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
      return report(
        ctx,
        quasi,
        'This template has an invalid escape sequence.',
        'Escape the backslash: \\\\.',
        site
      )
    }
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
  const resourceKind = RESOURCE_CALLS[path]
  if (resourceKind) {
    const argument = singleStringArgument(ctx, call, path, site)
    if (!argument) return null
    const value: Value = { $sim: 'resource', kind: resourceKind, key: argument.text }
    return { kind: 'value', value, form: path === 'upload' ? 'upload' : 'resource' }
  }
  switch (path) {
    case 'picked': {
      const argument = singleStringArgument(ctx, call, 'picked', site)
      return argument ? { kind: 'value', value: argument.text, form: 'picked' } : null
    }
    case 'ref': {
      const argument = singleStringArgument(ctx, call, 'ref', site)
      return argument ? { kind: 'value', value: `<${argument.text}>`, form: 'ref' } : null
    }
    case 'file': {
      const argument = singleStringArgument(ctx, call, 'file', site)
      return argument ? { kind: 'file', path: argument.text, pathNode: argument.node } : null
    }
    case 'todo':
      if (call.arguments.length > 0)
        return report(ctx, call, 'todo() takes no arguments.', 'Write todo().', site)
      return { kind: 'todo' }
    case 'raw': {
      const [argument, ...extra] = call.arguments
      if (!argument || extra.length > 0 || argument.type === 'SpreadElement') {
        return report(ctx, call, 'raw() takes one literal.', 'Write raw(value).', site)
      }
      const value = rawLiteral(ctx, argument, site)
      return value === undefined ? null : { kind: 'value', value, form: 'raw' }
    }
    default:
      return report(ctx, call, `${path}() is not a value.`, HINTS.bindInline, site)
  }
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
      return report(
        ctx,
        node,
        'Array holes are not values.',
        'Write each element explicitly.',
        site
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
      return report(
        ctx,
        node,
        'An object with a $sim key must hold plain data.',
        'Write the canonical value with raw(...).',
        site
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

function nestedValue(
  ctx: CompileContext,
  node: Node,
  compiled: CompiledValue,
  site: ValueSite
): Value | undefined {
  if (compiled.kind === 'value') return compiled.value
  if (compiled.kind === 'absent') return null
  report(
    ctx,
    node,
    compiled.kind === 'todo'
      ? 'todo() stands for a whole param.'
      : 'file() holds a whole code param.',
    compiled.kind === 'todo'
      ? 'Write todo() as the param value.'
      : "Write code: file('./fns/x.js').",
    site
  )
  return undefined
}

/**
 * Statically evaluates one value expression (s3 §4 "Values may be"). Nothing runs: only literal
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
          : report(
              ctx,
              node,
              'This template has an invalid escape sequence.',
              'Escape the backslash: \\\\.',
              site
            )
      }
      return { kind: 'value', value: text, form: 'literal' }
    }
    case 'TaggedTemplateExpression': {
      const tag = node.tag.type === 'Identifier' ? lookup(site.scope, node.tag.name) : null
      if (!tag || tag.kind !== 'sdk' || !TEMPLATE_TAGS.has(tag.name))
        return rejectNode(ctx, node, site)
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
 * A literal-only JSON value (variables, `$unknown`, retry, tool policy): plain data, so a `$sim`
 * key is just a key. No refs, no SDK calls.
 */
export function compileJsonLiteral(
  ctx: CompileContext,
  node: Node,
  site?: ValueSite
): Json | undefined {
  return literalTree(ctx, node, site)
}
