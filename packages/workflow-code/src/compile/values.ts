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
import { WORKFLOW_RESOURCE_KINDS } from '@sim/workflow-types/resources'
import {
  isReservedWorkflowBlockName,
  normalizeWorkflowBlockName,
} from '@sim/workflow-types/workflow'
import type { CatalogOutput } from '../catalog/types'
import {
  ENV_VAR_NAME,
  formatMemberPath,
  formatStoredPath,
  isIndexSegment,
  isNameSegment,
  LOOP_PROPERTIES,
  PARALLEL_PROPERTIES,
  parseStoredPath,
  type RefSegment,
} from '../code-files/ref-path'
import { JsonRef, type JsonTree, jsonFieldText, valueTree } from '../json-fields'
import type { CanonicalParam, Json, ResourceKind, SubBlockId, Value, VarNode } from '../model'
import { setOwn } from '../records'
import { SDK_RESOURCE_CALLS } from '../sdk'
import {
  type BlockDecl,
  type CompileContext,
  catalogBlockOf,
  containerKindOf,
  enclosingContainers,
  type JsonFieldEntry,
  lookup,
  rangeOf,
  type Scope,
  unsupported,
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

export function isSelectorForm(form: ValueForm): boolean {
  return SELECTOR_FORMS.has(form)
}

/** Call-form resource constructors and the kind each produces. */
const RESOURCE_KIND_BY_CALL: ReadonlyMap<string, ResourceKind> = new Map(
  Object.entries(SDK_RESOURCE_CALLS).map(([kind, call]) => [call, kind as ResourceKind])
)

const TEMPLATE_TAGS = new Set(['t', 'js', 'json', 'md', 'py', 'sh'])

/** SDK functions that are values, not block builders. */
export const SDK_VALUE_FUNCTIONS = new Set([
  ...RESOURCE_KIND_BY_CALL.keys(),
  ...TEMPLATE_TAGS,
  'raw',
  'todo',
  'stored',
  'ref',
  'codeFile',
  'edge',
  'env',
  'vars',
])

const RESOURCE_KINDS: ReadonlySet<string> = new Set<string>([
  ...WORKFLOW_RESOURCE_KINDS.filter((kind) => kind !== 'env-var'),
  'workflow',
])

/** Named-form container outputs (`LoopResolver` / `ParallelResolver` `KNOWN_PROPERTIES`). */
const CONTAINER_OUTPUTS = ['results', 'result']

function rejectNode(ctx: CompileContext, node: Node, site?: ValueSite): null {
  return unsupported(
    ctx,
    node,
    `${node.type} is not supported in a workflow file.`,
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
      else unsupported(ctx, property, `The key ${key} is written twice.`, HINTS.duplicateKey)
      continue
    }
    seen.add(key)
    entries.push([key, property])
  }
  return entries
}

/**
 * `W_REF_NOT_NORMALIZED` for each hand-written `<Name.path>` in literal text whose head is not a
 * normalized block key, or names no declared block. Such text is kept verbatim, so a rename in the
 * same apply never rewrites it; the block's ident is the reference that follows the block.
 */
function checkLiteralRefs(ctx: CompileContext, node: Node, text: string, site: ValueSite): void {
  for (const token of findWorkflowReferenceTokens(text)) {
    if (token.kind !== 'workflow') continue
    const segments = parseStoredPath(token.value.slice(1, -1))
    const head = segments?.[0]
    if (!segments || head?.kind !== 'name') continue
    const normalized = normalizeWorkflowBlockName(head.name)
    if (
      normalized === head.name &&
      (isReservedWorkflowBlockName(head.name) || ctx.declsByKey.has(head.name))
    )
      continue
    const target = ctx.declsByKey.get(normalized)
    ctx.reporter.report(
      'W_REF_NOT_NORMALIZED',
      normalized === head.name
        ? `${token.value} names no block; the text is kept as written.`
        : `${token.value} is not written with the block key ${normalized}; the text is kept as written.`,
      rangeOf(ctx, node),
      {
        hint: target?.ident
          ? `Write \${${formatMemberPath(target.ident, segments.slice(1))}} in a template, so a rename follows the block.`
          : 'Reference a declared block through its ident, so a rename follows the block.',
        blockKey: site.decl.key,
      }
    )
  }
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
  const value = literalTree(ctx, node, site)
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
    return unsupported(
      ctx,
      property,
      `The path segment '${property.value}' cannot be written as a reference.`,
      "Use ref('block.path') for this spelling.",
      site.decl.key
    )
  }
  if (property.type === 'NumericLiteral' && isIndexSegment(property.value)) {
    return { kind: 'index', index: property.value }
  }
  return unsupported(
    ctx,
    member,
    'Element access needs a literal key.',
    HINTS.elementAccess,
    site.decl.key
  )
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
 * Compiles an identifier or member chain to its stored token text: a block chain to
 * `<key.path>`, `vars.x` to `<variable.x>`, `env.X` to `{{X}}`, a loop param to `<loop.prop>` (innermost loop of its kind) or `<key.prop>` (named form).
 */
function compileRef(ctx: CompileContext, node: Node, site: ValueSite): string | VarNode | null {
  const { root, members } =
    node.type === 'MemberExpression' ? flattenMembers(node) : { root: node, members: [] }
  if (root.type !== 'Identifier') return rejectNode(ctx, node, site)

  const binding = lookup(site.scope, root.name)
  if (!binding) {
    const elsewhere = ctx.declsByIdent.get(root.name)
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
        hint: didYouMean(root.name, visibleNames(site.scope)),
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
        return unsupported(
          ctx,
          node,
          'Reference one variable: vars.name.',
          'Write vars.name.',
          site.decl.key
        )
      }
      if (!ctx.variables.has(name)) {
        ctx.reporter.report(
          'E_UNKNOWN_VARIABLE',
          `No workflow variable is keyed ${name}.`,
          rangeOf(ctx, first),
          {
            hint: didYouMean(name, ctx.variables.keys(), (key) => `vars.${key}`),
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
      if (ctx.envNames && !ctx.envNames.has(name)) {
        ctx.reporter.report(
          'W_ENV_UNKNOWN',
          `The workspace has no env variable ${name}, so it resolves to nothing at run time.`,
          rangeOf(ctx, first),
          {
            hint: `Add ${name} under the workspace's or your environment variables, or use a name .sim/sdk/workspace.d.ts lists.`,
            blockKey: site.decl.key,
          }
        )
      }
      return `{{${name}}}`
    }
    case 'subflowScope':
      return subflowScopeRef(ctx, node, binding.container, members, site)
    case 'block': {
      const target = binding.decl
      const segments = segmentsOf(ctx, members, site)
      if (!segments) return null
      checkOutputPath(ctx, node, target, segments, site)
      if (target.order > site.decl.order && target !== site.decl) {
        ctx.reporter.report(
          'W_FORWARD_REF',
          `${target.ident ?? target.key} is declared after this block.`,
          rangeOf(ctx, node),
          { hint: 'Declare blocks before the blocks that read them.', blockKey: site.decl.key }
        )
      }
      return `<${formatStoredPath([{ kind: 'name', name: target.key }, ...segments])}>`
    }
  }
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
        { hint: didYouMean(first.name, known), blockKey: site.decl.key }
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
      return unsupported(ctx, call, `${path}() is not a value.`, HINTS.bindInline, site.decl.key)
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
  return value === undefined ? undefined : valueTree(value)
}

/**
 * A literal-only JSON value (variables, a container's `extra` data, retry, tool policy): plain data, so a `$sim`
 * key is just a key. No refs, no SDK calls.
 */
export function compileJsonLiteral(
  ctx: CompileContext,
  node: Node,
  site?: ValueSite
): Json | undefined {
  return literalTree(ctx, node, site)
}
