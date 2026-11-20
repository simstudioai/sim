import type {
  ArrowFunctionExpression,
  BlockStatement,
  CallExpression,
  Node,
  VariableDeclaration,
} from '@babel/types'
import {
  isReservedWorkflowBlockName,
  normalizeWorkflowBlockName,
} from '@sim/workflow-types/workflow'
import { encodeAnchor } from '../anchors'
import { literalText } from '../babel'
import { catalogBlock, catalogBuilder, catalogBuilderPaths } from '../catalog/view'
import { type BlockKey, isLoopType, isParallelType, LOOP_TYPES, PARALLEL_TYPES } from '../model'
import { hasSuspiciousCharacter } from '../print/strings'
import { GENERIC_BUILDER } from '../sdk'
import { codePointLabel, mixedScriptCharacter } from './characters'
import type { ListOptions } from './comments'
import {
  type BlockDecl,
  type CompileContext,
  EDGE_METHODS,
  isSdkImportable,
  lookup,
  type ResolvedBuilder,
  rangeOf,
  recordSpan,
  reportNotImported,
  type Scope,
  unsupported,
} from './context'
import { closest, HINTS, hintForNode, nodeLabel, suggestBuilder } from './hints'
import { calleePath, SDK_VALUE_FUNCTIONS } from './values'

type CallClass =
  | { kind: 'builder'; builder: ResolvedBuilder; path: string }
  | { kind: 'value' }
  | { kind: 'wiring' }
  | { kind: 'other' }

/** Whether `call` is wiring: `x.to(...)`, `x.onError(...)`, a chain of those, or `edge(...)`. */
function isWiringCall(scope: Scope, call: CallExpression): boolean {
  const callee = call.callee
  if (callee.type === 'Identifier') {
    const binding = lookup(scope, callee.name)
    return binding?.kind === 'sdk' && binding.name === 'edge'
  }
  return (
    callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.property.type === 'Identifier' &&
    EDGE_METHODS.has(callee.property.name)
  )
}

/** Classifies a call against the SDK surface and the catalog's builders. */
function classifyCall(ctx: CompileContext, scope: Scope, call: CallExpression): CallClass {
  if (isWiringCall(scope, call)) return { kind: 'wiring' }
  const path = calleePath(call.callee)
  if (!path) return { kind: 'other' }
  const binding = lookup(scope, path.root)
  if (!binding && path.rest.length > 0) {
    // `loop.for(...)` or `slack.sendMessage(...)` with no import, or `discord.sendMessage(...)`:
    // a builder namespace the SDK does not have.
    const dotted = [path.root, ...path.rest].join('.')
    if (isSdkImportable(ctx, path.root)) {
      reportNotImported(ctx, 'E_UNKNOWN_BUILDER', path.root, call.callee)
    } else {
      ctx.reporter.report(
        'E_UNKNOWN_BUILDER',
        `${dotted} is not a block builder: ${path.root} is not an SDK namespace.`,
        rangeOf(ctx, call.callee),
        { hint: suggestBuilder(dotted, catalogBuilderPaths(ctx.catalog)) }
      )
    }
    return { kind: 'builder', path: dotted, builder: { kind: 'unknown' } }
  }
  const [firstArgument] = call.arguments
  const bareBuilderPaths =
    !binding && firstArgument && literalText(firstArgument) !== null
      ? [...catalogBuilderPaths(ctx.catalog), GENERIC_BUILDER, 'parallel']
      : null
  const imported = bareBuilderPaths?.includes(path.root) === true
  if (bareBuilderPaths && (imported || closest(path.root, bareBuilderPaths) !== null)) {
    // `apii('Call', { ... })`: a bare, builder-shaped call nothing binds, naming a builder or close
    // to one (`fetch('x')` stays an unsupported call). It classifies as an unknown builder so the
    // const still binds and its wiring raises no E_UNKNOWN_IDENTIFIER.
    if (imported) {
      reportNotImported(ctx, 'E_UNKNOWN_BUILDER', path.root, call.callee)
    } else {
      ctx.reporter.report(
        'E_UNKNOWN_BUILDER',
        `${path.root} is not a block builder.`,
        rangeOf(ctx, call.callee),
        { hint: suggestBuilder(path.root, bareBuilderPaths) }
      )
    }
    return { kind: 'builder', path: path.root, builder: { kind: 'unknown' } }
  }
  if (!binding || binding.kind !== 'sdk') return { kind: 'other' }
  const root = binding.name
  const dotted = [root, ...path.rest].join('.')

  const method = path.rest[0]
  if (root === 'loop' && path.rest.length === 1 && isLoopType(method)) {
    return {
      kind: 'builder',
      path: dotted,
      builder: { kind: 'container', container: 'loop', method },
    }
  }
  if (root === 'parallel' && path.rest.length <= 1) {
    if (method === undefined || isParallelType(method)) {
      return {
        kind: 'builder',
        path: dotted,
        builder: { kind: 'container', container: 'parallel', method: method ?? null },
      }
    }
  }
  if (root === GENERIC_BUILDER && path.rest.length === 0) {
    const typeArgument = call.arguments[0]
    const type = typeArgument ? literalText(typeArgument) : null
    if (type === null) {
      unsupported(
        ctx,
        typeArgument ?? call,
        'block() takes the type as a string literal.',
        "Write block('custom_type', 'Name', { ... })."
      )
      return { kind: 'builder', path: dotted, builder: { kind: 'unknown' } }
    }
    return {
      kind: 'builder',
      path: dotted,
      builder: { kind: 'generic', type, block: catalogBlock(ctx.catalog, type) },
    }
  }
  if (path.rest.length === 0 && SDK_VALUE_FUNCTIONS.has(root)) return { kind: 'value' }

  const builder = catalogBuilder(ctx.catalog, dotted)
  if (!builder) {
    const candidates = [
      ...catalogBuilderPaths(ctx.catalog),
      ...LOOP_TYPES.map((method) => `loop.${method}`),
      ...PARALLEL_TYPES.map((method) => `parallel.${method}`),
    ]
    ctx.reporter.report(
      'E_UNKNOWN_BUILDER',
      `${dotted} is not a block builder.`,
      rangeOf(ctx, call.callee),
      { hint: suggestBuilder(dotted, candidates) }
    )
    return { kind: 'builder', path: dotted, builder: { kind: 'unknown' } }
  }
  return {
    kind: 'builder',
    path: dotted,
    builder: {
      kind: 'catalog',
      path: dotted,
      type: builder.type,
      builder,
      block: catalogBlock(ctx.catalog, builder.type),
    },
  }
}

/** Index of the name argument: `block(type, name, ...)` takes the type first. */
function nameArgumentIndex(builder: ResolvedBuilder, path: string): number {
  return builder.kind === 'generic' || path === GENERIC_BUILDER ? 1 : 0
}

/** `name~n` with n ≥ 2, the form canonicalize gives the loser of a legacy name collision. */
export function collisionSuffix(key: string, base: string): boolean {
  return key.startsWith(`${base}~`) && /^(?:[2-9]|[1-9]\d+)$/.test(key.slice(base.length + 1))
}

/**
 * Reads `meta.key`: the source form of a legacy key that the display name cannot carry. It is
 * accepted only for a key already bound to an id (`CompileInput.knownKeys`) and only in one of
 * the two legacy shapes canonicalize produces: the block's reserved normalized name (`Loop`,
 * `Parallel`), or the `~n` collision form of its normalized name. So source can keep such a
 * block losslessly but can never introduce one. `null` when there is no `meta.key` or it was
 * rejected (`E_KEY_OVERRIDE`), in which case the normalized name is the key.
 */
function keyOverride(
  ctx: CompileContext,
  metaNode: Node | undefined,
  normalized: string
): { key: BlockKey; collisionBase?: { base: BlockKey; node: Node } } | null {
  if (!metaNode || metaNode.type !== 'ObjectExpression') return null
  const property = metaNode.properties.find(
    (candidate) =>
      candidate.type === 'ObjectProperty' &&
      !candidate.computed &&
      ((candidate.key.type === 'Identifier' && candidate.key.name === 'key') ||
        (candidate.key.type === 'StringLiteral' && candidate.key.value === 'key'))
  )
  if (!property || property.type !== 'ObjectProperty') return null
  const reject = (message: string): null => {
    ctx.reporter.report('E_KEY_OVERRIDE', message, rangeOf(ctx, property), {
      hint: 'meta.key only keeps a legacy key the stored workflow already has; remove it and rename the block.',
    })
    return null
  }
  const key = literalText(property.value)
  if (key === null) return reject('meta.key must be a string literal.')
  if (!ctx.knownKeys.has(key)) {
    return reject(`meta.key ${key} is not a key of this workflow's stored blocks.`)
  }
  if (key === normalized && isReservedWorkflowBlockName(key)) return { key }
  if (collisionSuffix(key, normalized)) {
    return { key, collisionBase: { base: normalized, node: property } }
  }
  return reject(
    `meta.key ${key} is neither the reserved name ${normalized} nor a ${normalized}~n collision key.`
  )
}

/**
 * `W_SUSPICIOUS_CHARACTER` when `name` (a block's or the workflow's) holds a character that
 * reorders or hides text, so the name reads differently from what it stores.
 */
export function checkSuspiciousName(
  ctx: CompileContext,
  name: string,
  node: Node,
  owner: 'block' | 'workflow'
): void {
  if (!hasSuspiciousCharacter(name)) return
  ctx.reporter.report(
    'W_SUSPICIOUS_CHARACTER',
    `This ${owner} name holds an invisible bidi control or zero-width character.`,
    rangeOf(ctx, node),
    { hint: 'Remove it, or write it as an escape (\\u202E) so reviewers can see it.' }
  )
}

/**
 * Refuses a block whose key equals another's once both are NFC-normalized (`café` written
 * precomposed and decomposed): the runtime binds keys by their bytes, so the two are distinct
 * blocks no reader can tell apart. A pair the stored workflow already holds only warns, so it
 * round-trips. The comparison form is never stored: each key stays as written. A name with a word
 * that mixes Latin letters with Cyrillic, Greek, Armenian or Cherokee ones (`Сlaude`, a Cyrillic
 * `С`) is refused the same way: it reads as a Latin name it is not, beside `Claude` or alone.
 */
function checkLookalikeName(ctx: CompileContext, decl: BlockDecl): void {
  const mixed = mixedScriptCharacter(decl.name)
  if (mixed) {
    ctx.reporter.report(
      ctx.knownKeys.has(decl.key) ? 'W_LOOKALIKE_NAME' : 'E_LOOKALIKE_NAME',
      `${decl.name} mixes ${mixed.script} and Latin letters in one word (${mixed.character} is ${codePointLabel(mixed.character)}, ${mixed.script}), so it looks like a name it is not.`,
      rangeOf(ctx, decl.nameNode),
      { hint: 'Retype the name so each word uses one alphabet.' }
    )
  }
  const folded = decl.key.normalize('NFC')
  const first = ctx.declsByLookalike.get(folded)
  if (!first) {
    ctx.declsByLookalike.set(folded, decl)
    return
  }
  if (first.key === decl.key) return
  const stored = ctx.knownKeys.has(first.key) && ctx.knownKeys.has(decl.key)
  ctx.reporter.report(
    stored ? 'W_LOOKALIKE_NAME' : 'E_LOOKALIKE_NAME',
    `${decl.name} looks the same as ${first.name} but is spelled with different Unicode characters, so they are two blocks.`,
    rangeOf(ctx, decl.nameNode),
    {
      hint: 'Rename one of them; retype the accented letters so both spell them the same way.',
      related: [{ at: rangeOf(ctx, first.nameNode), message: `${first.name} is declared here.` }],
    }
  )
}

/** Registers one block declaration, checking its name. */
function declare(
  ctx: CompileContext,
  scope: Scope,
  call: CallExpression,
  classified: Extract<CallClass, { kind: 'builder' }>,
  binding: { name: string; node: Node } | null,
  anchorNode: Node
): BlockDecl | null {
  const nameIndex = nameArgumentIndex(classified.builder, classified.path)
  const nameNode = call.arguments[nameIndex] ?? call
  const name = call.arguments[nameIndex] ? literalText(call.arguments[nameIndex]) : null
  if (name === null) {
    ctx.reporter.report(
      'E_NAME_NOT_LITERAL',
      'A block name must be a string literal.',
      rangeOf(ctx, nameNode),
      { hint: "Write the display name as a literal: api('Fetch user', { ... })." }
    )
    return null
  }
  const normalized = normalizeWorkflowBlockName(name)
  if (!normalized) {
    ctx.reporter.report('E_EMPTY_NAME', 'A block name cannot be empty.', rangeOf(ctx, nameNode), {
      hint: 'Give the block a display name.',
    })
    return null
  }
  checkSuspiciousName(ctx, name, nameNode, 'block')
  const metaIndex = classified.builder.kind === 'container' ? 3 : nameIndex + 2
  const override = keyOverride(ctx, call.arguments[metaIndex], normalized)
  const key = override?.key ?? normalized
  if (!override && isReservedWorkflowBlockName(normalized)) {
    ctx.reporter.report(
      'E_RESERVED_NAME',
      `${name} is reserved for <${key}.…> references.`,
      rangeOf(ctx, nameNode),
      { hint: 'Pick another display name.' }
    )
    return null
  }

  const container = scope.container
  const decl: BlockDecl = {
    key,
    name,
    ident: binding?.name ?? null,
    call,
    anchorNode,
    nameNode,
    scope,
    parent: container,
    order: ctx.decls.length,
    builder: classified.builder,
    duplicate: false,
    ...(override?.collisionBase && { collisionBase: override.collisionBase }),
  }
  const first = ctx.declsByKey.get(key)
  if (first) {
    decl.duplicate = true
    ctx.reporter.report(
      'E_DUPLICATE_NAME',
      `${name} normalizes to ${key}, which ${first.name} already uses.`,
      rangeOf(ctx, nameNode),
      {
        hint: 'Block names are unique after lowercasing and removing spaces and dots.',
        related: [{ at: rangeOf(ctx, first.nameNode), message: `${first.name} is declared here.` }],
      }
    )
  } else {
    ctx.declsByKey.set(key, decl)
    checkLookalikeName(ctx, decl)
  }
  ctx.decls.push(decl)
  if (binding) {
    scope.bindings.set(binding.name, { kind: 'block', decl })
    const all = ctx.declsByIdent.get(binding.name) ?? []
    all.push(decl)
    ctx.declsByIdent.set(binding.name, all)
  }
  if (!decl.duplicate) recordSpan(ctx, { kind: 'block', block: key }, anchorNode)
  if (classified.builder.kind === 'container') collectContainerBody(ctx, decl)
  return decl
}

/** `(p) => { ... }` or `(p) => block(...)`, the third argument of loop/parallel. */
function collectContainerBody(ctx: CompileContext, decl: BlockDecl): void {
  const body = decl.call.arguments[2]
  if (!body || body.type !== 'ArrowFunctionExpression' || body.async || body.params.length > 1) {
    unsupported(
      ctx,
      body ?? decl.call,
      'A loop or parallel takes its body as an arrow function.',
      "Write loop.forEach('Name', { collection }, (p) => { ... })."
    )
    return
  }
  const scope: Scope = { parent: decl.scope, bindings: new Map(), container: decl }
  const param = body.params[0]
  if (param) {
    if (param.type !== 'Identifier') {
      unsupported(ctx, param, 'The loop parameter must be a plain identifier.', HINTS.destructuring)
    } else {
      if (param.typeAnnotation)
        unsupported(ctx, param.typeAnnotation, 'Type annotations are not supported.', HINTS.types)
      scope.bindings.set(param.name, { kind: 'subflowScope', container: decl })
    }
  }
  if (body.body.type === 'BlockStatement') {
    collectBody(ctx, body.body, scope, {
      owner: encodeAnchor({ kind: 'block', block: decl.key }),
      tail: { anchor: encodeAnchor({ kind: 'block', block: decl.key }), placement: 'trailing' },
    })
    return
  }
  collectArrowExpressionBody(ctx, decl, scope, body)
}

function collectArrowExpressionBody(
  ctx: CompileContext,
  container: BlockDecl,
  scope: Scope,
  body: ArrowFunctionExpression
): void {
  const expression = body.body
  if (expression.type === 'CallExpression') {
    const classified = classifyCall(ctx, scope, expression)
    if (classified.kind === 'builder') {
      const child = declare(ctx, scope, expression, classified, null, expression)
      if (child) ctx.implied.push({ container, child, body })
      return
    }
  }
  unsupported(
    ctx,
    expression,
    'An arrow-expression body must be one block call.',
    'Use a block body: (p) => { ... }.'
  )
}

function collectDeclaration(
  ctx: CompileContext,
  scope: Scope,
  statement: VariableDeclaration
): void {
  if (statement.kind !== 'const') {
    unsupported(ctx, statement, `${statement.kind} is not supported.`, HINTS.let)
    return
  }
  if (statement.declarations.length !== 1) {
    unsupported(
      ctx,
      statement,
      'Declare one block per const.',
      'Split this into one const per block.'
    )
    return
  }
  const [declarator] = statement.declarations
  if (declarator.id.type !== 'Identifier') {
    unsupported(ctx, declarator.id, 'Destructuring is not supported.', HINTS.destructuring)
    return
  }
  if (declarator.id.typeAnnotation) {
    unsupported(
      ctx,
      declarator.id.typeAnnotation,
      'Type annotations are not supported.',
      HINTS.types
    )
    return
  }
  const init = declarator.init
  if (
    init &&
    (init.type === 'ArrowFunctionExpression' ||
      init.type === 'FunctionExpression' ||
      init.type === 'ClassExpression')
  ) {
    unsupported(ctx, init, 'Helpers are not supported.', HINTS.helpers)
    return
  }
  const { name } = declarator.id
  const refuseValue = () => {
    ctx.valueConsts.add(name)
    unsupported(ctx, statement, `${name} holds a value, not a block.`, HINTS.nonBuilderConst)
  }
  if (!init || init.type !== 'CallExpression') {
    refuseValue()
    return
  }
  const classified = classifyCall(ctx, scope, init)
  if (classified.kind !== 'builder') {
    refuseValue()
    return
  }
  declare(ctx, scope, init, classified, { name, node: declarator.id }, statement)
}

/**
 * Pass 1 over one body (the workflow's or a loop's): registers every block declaration in source
 * order, nested bodies included, so references resolve regardless of order, and queues
 * wiring statements for pass 2. Any other statement is rejected with its s3 hint.
 */
export function collectBody(
  ctx: CompileContext,
  body: BlockStatement,
  scope: Scope,
  listOptions: ListOptions
): void {
  for (const directive of body.directives) {
    unsupported(
      ctx,
      directive,
      'A string statement is not supported in a workflow body.',
      'Delete it; a body holds block declarations and wiring.'
    )
  }
  const addItem = ctx.comments.list(body.start ?? 0, body.end ?? 0, listOptions)
  let firstWiringSeen = scope.container !== null
  for (const statement of body.body) {
    if (statement.type === 'EmptyStatement') continue
    if (statement.type === 'VariableDeclaration') {
      const before = ctx.decls.length
      collectDeclaration(ctx, scope, statement)
      const decl = ctx.decls[before]
      addItem(
        statement,
        decl && !decl.duplicate ? encodeAnchor({ kind: 'block', block: decl.key }) : null
      )
      continue
    }
    if (
      statement.type === 'ExpressionStatement' &&
      statement.expression.type === 'CallExpression'
    ) {
      const classified = classifyCall(ctx, scope, statement.expression)
      if (classified.kind === 'builder') {
        const decl = declare(ctx, scope, statement.expression, classified, null, statement)
        addItem(
          statement,
          decl && !decl.duplicate ? encodeAnchor({ kind: 'block', block: decl.key }) : null
        )
        continue
      }
      if (classified.kind === 'wiring') {
        const firstWiring = !firstWiringSeen
        firstWiringSeen = true
        ctx.wiring.push({ statement, scope, firstWiring, addItem })
        continue
      }
      unsupported(
        ctx,
        statement.expression,
        `${nodeLabel(statement.expression)} is not supported here.`,
        classified.kind === 'value' ? HINTS.bindInline : hintForNode(statement.expression)
      )
      addItem(statement, null)
      continue
    }
    const node = statement.type === 'ExpressionStatement' ? statement.expression : statement
    unsupported(
      ctx,
      node,
      `${nodeLabel(node)} is not supported in a workflow body.`,
      hintForNode(node)
    )
    addItem(statement, null)
  }
}
