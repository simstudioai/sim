import type { ArrowFunctionExpression, CallExpression, Node } from '@babel/types'
import { compareStrings } from '@sim/utils/string'
import {
  isVariableType,
  normalizeWorkflowBlockName,
  VARIABLE_TYPES,
  type VariableType,
} from '@sim/workflow-types/workflow'
import { encodeAnchor } from '../anchors'
import { literalText } from '../babel'
import { compareEdges } from '../canonicalize/edges'
import type { BlockCatalog } from '../catalog/types'
import type { CompileDiagnosticCode } from '../diagnostics/codes'
import type { LocatedDiagnostic, SourceSpan } from '../diagnostics/frame'
import { jsonFieldText, type RefTypeScope, refValueKind } from '../json-fields'
import { utf8Bytes } from '../limits'
import type { SourceHints } from '../lock'
import type {
  AnchorKey,
  BlockKey,
  CanonicalBlock,
  CanonicalVariable,
  CanonicalWorkflow,
  VarKey,
} from '../model'
import { setOwn } from '../records'
import { OLDEST_SDK_MAJOR, SDK_MODULE } from '../sdk'
import { compileBlock } from './blocks'
import { checkStorableLiterals, checkStorableText } from './characters'
import { CommentCollector } from './comments'
import { type CompileContext, rangeOf, recordSpan, type Scope, unsupported } from './context'
import { EdgeCollector } from './edges'
import { didYouMean, HINTS, hintForNode, nodeLabel } from './hints'
import { type CompileLimits, DEFAULT_LIMITS, parseWorkflowSource, sdkHeader } from './parse'
import { ErrorLimitReached, Reporter } from './report'
import { checkSuspiciousName, collectBody, collisionSuffix } from './scope'
import {
  checkCodeFileRefs,
  checkErrorOutputRefs,
  checkResponseFormatRefs,
  compileJsonLiteral,
  objectEntries,
} from './values'

/** One compile: the entry file, the code files it may read, and what the server knows. */
export interface CompileInput {
  entry: { path: string; text: string }
  /** Function-code files by repo-relative path; the caller does the I/O. */
  files: ReadonlyMap<string, string>
  catalog: BlockCatalog
  /** The highest `@sim-sdk` major the caller supports. */
  sdkMajor: number
  limits?: CompileLimits
  /**
   * Block keys already bound to stored ids: the keys of the lock, or of the lock assembled from
   * `workflow_source_meta`. A `meta.key` override (a legacy `name~n` collision key or a reserved
   * name) compiles only for one of these, so source can carry a legacy key losslessly but never
   * introduce one. Absent means no override is accepted.
   */
  knownKeys?: ReadonlySet<BlockKey>
  /**
   * The stored workflow the source continues, canonicalized as it was printed. `stored()` (what
   * the printer writes for a secret it never shows) compiles to this workflow's value for the same
   * block key, type and param. Absent means `stored()` is refused, as for a new workflow.
   */
  stored?: CanonicalWorkflow
  /**
   * The env variable names a run resolves (the workspace's plus the caller's personal ones).
   * `env.NAME` outside it compiles with `W_ENV_UNKNOWN`; absent, no name is checked.
   */
  envNames?: ReadonlySet<string>
  /**
   * The file `envNames` are declared in (`secrets.ts` of a workspace source directory), which a
   * `W_ENV_UNKNOWN` hint points at; absent, the hint points at the workspace's env variables.
   */
  envDeclaredIn?: string
}

/** The compiled workflow (or `null` after an error) with its diagnostics, spans and lock hints. */
export interface CompileResult {
  /** `null` iff any diagnostic is an error. Name-keyed, like every CWM: ids bind in materialize. */
  workflow: CanonicalWorkflow | null
  /** Spans into the entry count from after a leading byte order mark (see `compileWorkflow`). */
  diagnostics: LocatedDiagnostic<CompileDiagnosticCode>[]
  /** Where each anchor sits, to map later server findings back to lines. */
  spans: Partial<Record<AnchorKey, SourceSpan>>
  /** Idents as written, `order` as declaration index, and code files, for the lock. */
  hints: SourceHints
  /** The header's major, or `null` when the header is missing. */
  sdkMajor: number | null
  /**
   * Every env name the source reads (`env.NAME`, and `$env.NAME` in code files), sorted: what a
   * workspace apply checks against the secrets its directory declares.
   */
  envReferences: string[]
}

const WORKFLOW_OPTIONS = ['description', 'variables']

/** Module scope: the SDK's named imports. */
function collectImports(ctx: CompileContext, node: Node, scope: Scope): void {
  if (node.type !== 'ImportDeclaration') return
  if (node.source.value !== SDK_MODULE || node.importKind === 'type') {
    unsupported(
      ctx,
      node,
      node.importKind === 'type'
        ? 'Type imports are not needed.'
        : `${node.source.value} cannot be imported.`,
      node.importKind === 'type' ? HINTS.types : HINTS.otherImport
    )
    return
  }
  for (const specifier of node.specifiers) {
    if (specifier.type !== 'ImportSpecifier' || specifier.importKind === 'type') {
      unsupported(
        ctx,
        specifier,
        'Import named SDK exports only.',
        "Write import { workflow } from '@sim/workflow-sdk'."
      )
      continue
    }
    const imported =
      specifier.imported.type === 'Identifier' ? specifier.imported.name : specifier.imported.value
    // The exported `vars` is the body parameter's `vars`, untyped (core.d.ts).
    scope.bindings.set(
      specifier.local.name,
      imported === 'vars' ? { kind: 'vars' } : { kind: 'sdk', name: imported }
    )
  }
}

/**
 * Whether a written `name` keeps a variable reachable by its key: references compile to
 * `<variable.key>`, and the resolver matches them against the stored name normalized. So the name
 * must normalize to the key, or the key is the `~n` form canonicalize gives a legacy collision.
 */
function namesVariableKey(name: string, key: VarKey): boolean {
  const normalized = normalizeWorkflowBlockName(name)
  return normalized === key || collisionSuffix(key, normalized)
}

function compileVariables(ctx: CompileContext, node: Node): void {
  if (node.type !== 'ObjectExpression') {
    unsupported(
      ctx,
      node,
      'variables is an object literal.',
      "Write variables: { name: { type: 'string', value: '' } }."
    )
    return
  }
  const entries = objectEntries(ctx, node)
  const addItem = ctx.comments.list(node.start ?? 0, node.end ?? 0, {
    owner: encodeAnchor({ kind: 'header' }),
    tail: 'last-item',
  })
  const firstByKey = new Map<VarKey, Node>()
  for (const [propertyKey, property] of entries) {
    const key = normalizeWorkflowBlockName(propertyKey)
    let name = propertyKey
    addItem(property, key ? encodeAnchor({ kind: 'var', variable: key }) : null)
    const first = firstByKey.get(key)
    if (first) {
      ctx.reporter.report(
        'E_DUPLICATE_VARIABLE',
        `${propertyKey} normalizes to ${key}, which is already declared.`,
        rangeOf(ctx, property),
        {
          hint: 'Variable names are unique after lowercasing and removing spaces and dots.',
          related: [{ at: rangeOf(ctx, first), message: 'First declared here.' }],
        }
      )
      continue
    }
    if (!key) {
      unsupported(ctx, property, 'A variable name cannot be empty.', 'Name the variable.')
      continue
    }
    firstByKey.set(key, property)
    recordSpan(ctx, { kind: 'var', variable: key }, property)
    const declaration = property.value
    if (declaration.type !== 'ObjectExpression') {
      unsupported(
        ctx,
        declaration,
        'A variable is { type, value }.',
        "Write { type: 'string', value: '' }."
      )
      continue
    }
    let type: VariableType | null = null
    let typeWritten = false
    let value: CanonicalVariable['value'] | undefined
    let valueWritten = false
    for (const [field, fieldProperty] of objectEntries(ctx, declaration)) {
      if (field === 'type') {
        typeWritten = true
        const text = literalText(fieldProperty.value)
        if (text !== null && isVariableType(text)) {
          type = text
        } else {
          unsupported(
            ctx,
            fieldProperty.value,
            'Unknown variable type.',
            `Types are ${VARIABLE_TYPES.join(', ')}.`
          )
        }
      } else if (field === 'name') {
        const text = literalText(fieldProperty.value)
        if (text === null) {
          unsupported(
            ctx,
            fieldProperty.value,
            'name is a string literal.',
            "Write name: 'Display name'."
          )
        } else if (!namesVariableKey(text, key)) {
          ctx.reporter.report(
            'E_VARIABLE_NAME_MISMATCH',
            `name '${text}' does not normalize to the variable key ${key}, so vars.${propertyKey} would not reach it.`,
            rangeOf(ctx, fieldProperty.value),
            {
              hint: 'Rename the property to the name, or drop name. A variable is keyed by its name lowercased, without spaces or dots.',
            }
          )
        } else {
          name = text
        }
      } else if (field === 'value') {
        valueWritten = true
        value = compileJsonLiteral(ctx, fieldProperty.value)
      } else {
        unsupported(
          ctx,
          fieldProperty,
          `${field} is not a variable field.`,
          'A variable is { type, value }.'
        )
      }
    }
    if (!typeWritten)
      unsupported(ctx, declaration, 'A variable needs a type.', "Write type: 'string'.")
    if (!valueWritten)
      unsupported(ctx, declaration, 'A variable needs a value.', "Write value: ''.")
    if (type === null || value === undefined) continue
    ctx.variables.set(key, { key, name, type, value })
  }
}

interface WorkflowHeader {
  name: string
  description: string | null
}

function compileWorkflowCall(
  ctx: CompileContext,
  call: CallExpression,
  moduleScope: Scope
): WorkflowHeader | null {
  const [nameNode, second, third, ...extra] = call.arguments
  for (const node of extra)
    unsupported(ctx, node, 'Too many arguments.', 'Write workflow(name, options, body).')
  const name = nameNode ? literalText(nameNode) : null
  if (name === null) {
    ctx.reporter.report(
      'E_NAME_NOT_LITERAL',
      'The workflow name must be a string literal.',
      rangeOf(ctx, nameNode ?? call),
      {
        hint: "Write workflow('Name', {}, ({ vars }) => { ... }).",
      }
    )
  } else if (nameNode) {
    checkSuspiciousName(ctx, name, nameNode, 'workflow')
  }
  const optionsNode: Node | undefined = third ? second : undefined
  const bodyNode: Node | undefined = third ?? second

  let description: string | null = null
  if (optionsNode) {
    if (optionsNode.type !== 'ObjectExpression') {
      unsupported(
        ctx,
        optionsNode,
        'Workflow options are an object literal.',
        "Write { description: '...' }."
      )
    } else {
      for (const [key, property] of objectEntries(ctx, optionsNode)) {
        if (key === 'description') {
          description = literalText(property.value)
          if (description === null)
            unsupported(
              ctx,
              property.value,
              'description is a string literal.',
              "Write description: '...'."
            )
        } else if (key === 'variables') {
          compileVariables(ctx, property.value)
        } else {
          ctx.reporter.report(
            'E_UNKNOWN_PARAM',
            `${key} is not a workflow option.`,
            rangeOf(ctx, property),
            { hint: didYouMean(key, WORKFLOW_OPTIONS) }
          )
        }
      }
    }
  }

  if (
    !bodyNode ||
    bodyNode.type !== 'ArrowFunctionExpression' ||
    bodyNode.async ||
    bodyNode.body.type !== 'BlockStatement'
  ) {
    unsupported(
      ctx,
      bodyNode ?? call,
      'The workflow body is an arrow function with a block body.',
      "Write workflow('Name', {}, ({ vars }) => { ... })."
    )
    return name === null ? null : { name, description }
  }
  const scope: Scope = { parent: moduleScope, bindings: new Map(), container: null }
  bindBodyParams(ctx, bodyNode, scope)
  collectBody(ctx, bodyNode.body, scope, {
    owner: encodeAnchor({ kind: 'footer' }),
    tail: { anchor: encodeAnchor({ kind: 'footer' }), placement: 'leading' },
  })
  return name === null ? null : { name, description }
}

function bindBodyParams(ctx: CompileContext, body: ArrowFunctionExpression, scope: Scope): void {
  const [param, ...extra] = body.params
  for (const node of extra)
    unsupported(ctx, node, 'The body takes one parameter.', 'Write ({ vars }) => { ... }.')
  if (!param) return
  if (param.type !== 'ObjectPattern') {
    unsupported(
      ctx,
      param,
      'Destructure vars from the body parameter.',
      'Write ({ vars }) => { ... }.'
    )
    return
  }
  for (const property of param.properties) {
    if (
      property.type === 'ObjectProperty' &&
      !property.computed &&
      property.key.type === 'Identifier' &&
      property.key.name === 'vars' &&
      property.value.type === 'Identifier'
    ) {
      scope.bindings.set(property.value.name, { kind: 'vars' })
      continue
    }
    unsupported(
      ctx,
      property,
      'The body parameter offers only vars.',
      'Write ({ vars }) => { ... }.'
    )
  }
}

function emptyResult(reporter: Reporter, sdkMajor: number | null): CompileResult {
  return {
    workflow: null,
    diagnostics: reporter.diagnostics,
    spans: {},
    hints: { blocks: {} },
    sdkMajor,
    envReferences: [],
  }
}

const BYTE_ORDER_MARK = '\uFEFF'

/**
 * Statically interprets a workflow source file into the canonical model. Pass 1 collects
 * imports and every block declaration, nested bodies included; pass 2 evaluates values,
 * references, branches and wiring against the catalog. Nothing in the file is executed: values are
 * read from literal syntax only, and anything else is a located diagnostic.
 *
 * A leading byte order mark (Windows editors, PowerShell 5.1) is dropped before anything reads the
 * entry, so it cannot hide the SDK header. Every span of the entry, offsets included, is into the
 * text after it, which is also where editors put line 1 column 1.
 */
export function compileWorkflow(input: CompileInput): CompileResult {
  const file = input.entry.path
  const text = input.entry.text.startsWith(BYTE_ORDER_MARK)
    ? input.entry.text.slice(BYTE_ORDER_MARK.length)
    : input.entry.text
  const reporter = new Reporter()
  reporter.addFile(file, text)
  try {
    return compileEntry(input, file, text, reporter)
  } catch (error) {
    if (error instanceof ErrorLimitReached) return emptyResult(reporter, sdkHeader(text).sdkMajor)
    throw error
  }
}

function compileEntry(
  input: CompileInput,
  file: string,
  text: string,
  reporter: Reporter
): CompileResult {
  const limits = { ...DEFAULT_LIMITS, ...input.limits }
  if (utf8Bytes(text, limits.maxTotalBytes) <= limits.maxTotalBytes)
    checkStorableText(file, text, reporter)
  const parsed = parseWorkflowSource(file, text, limits, reporter)
  if (parsed.sdkMajor === null) {
    reporter.report(
      'E_SDK_HEADER',
      'The first line must be the SDK header.',
      { file, start: 0, end: 0 },
      {
        hint: `Start the file with // @sim-sdk ${input.sdkMajor}.`,
      }
    )
  } else if (parsed.sdkMajor > input.sdkMajor) {
    reporter.report(
      'E_SDK_MAJOR',
      `This file targets SDK ${parsed.sdkMajor}; this server supports up to ${input.sdkMajor}.`,
      { file, start: 0, end: parsed.headerEnd },
      { hint: `Write // @sim-sdk ${input.sdkMajor}, or update Sim.` }
    )
  } else if (parsed.sdkMajor < OLDEST_SDK_MAJOR) {
    reporter.report(
      'E_SDK_MAJOR_OLD',
      `This file targets SDK ${parsed.sdkMajor}; this server supports SDK ${OLDEST_SDK_MAJOR} to ${input.sdkMajor}.`,
      { file, start: 0, end: parsed.headerEnd },
      {
        hint: `Rewrite the file for SDK ${input.sdkMajor}: run sim workflows source get to print it again.`,
      }
    )
  }
  const ast = parsed.ast
  if (!ast) return emptyResult(reporter, parsed.sdkMajor)
  checkStorableLiterals(file, text, ast, reporter)

  const ctx: CompileContext = {
    file,
    reporter,
    catalog: input.catalog,
    files: input.files,
    limits,
    codeFiles: { reads: new Map(), refs: 0, bytes: utf8Bytes(text), chains: [] },
    comments: new CommentCollector(file, reporter),
    decls: [],
    declsByKey: new Map(),
    declsByIdent: new Map(),
    declsByLookalike: new Map(),
    variables: new Map(),
    wiring: [],
    implied: [],
    spans: new Map(),
    knownKeys: input.knownKeys ?? new Set(),
    stored: input.stored,
    envNames: input.envNames,
    envDeclaredIn: input.envDeclaredIn,
    envReferences: new Set(),
    jsonFields: [],
    responseFormatRefs: [],
    errorOutputRefs: [],
    refusedBranches: new Map(),
    valueConsts: new Set(),
  }

  const moduleScope: Scope = { parent: null, bindings: new Map(), container: null }
  const header = encodeAnchor({ kind: 'header' })
  const addModuleItem = ctx.comments.list(0, text.length, {
    owner: header,
    tail: { anchor: encodeAnchor({ kind: 'footer' }), placement: 'leading' },
  })
  if (parsed.sdkMajor !== null)
    recordSpan(ctx, { kind: 'header' }, { start: 0, end: parsed.headerEnd })

  for (const statement of ast.program.body) collectImports(ctx, statement, moduleScope)
  for (const directive of ast.program.directives)
    unsupported(
      ctx,
      directive,
      'A string statement is not allowed at the top level.',
      HINTS.extraStatement
    )

  let workflowHeader: WorkflowHeader | null = null
  let exportCount = 0
  for (const statement of ast.program.body) {
    if (statement.type === 'ImportDeclaration') {
      addModuleItem(statement, header)
      continue
    }
    addModuleItem(statement, null)
    if (statement.type === 'ExportDefaultDeclaration') {
      exportCount++
      const declaration = statement.declaration
      const binding =
        declaration.type === 'CallExpression' && declaration.callee.type === 'Identifier'
          ? moduleScope.bindings.get(declaration.callee.name)
          : undefined
      if (
        exportCount > 1 ||
        declaration.type !== 'CallExpression' ||
        binding?.kind !== 'sdk' ||
        binding.name !== 'workflow'
      ) {
        reporter.report(
          'E_WORKFLOW_EXPORT',
          'The default export must be the one workflow(...) call.',
          rangeOf(ctx, declaration),
          {
            hint: "Write export default workflow('Name', {}, ({ vars }) => { ... }).",
          }
        )
        continue
      }
      workflowHeader = compileWorkflowCall(ctx, declaration, moduleScope) ?? workflowHeader
      continue
    }
    const hint =
      statement.type === 'ExportNamedDeclaration' || statement.type === 'ExportAllDeclaration'
        ? hintForNode(statement)
        : HINTS.extraStatement
    unsupported(ctx, statement, `${nodeLabel(statement)} is not allowed at the top level.`, hint)
  }
  if (exportCount === 0) {
    reporter.report(
      'E_WORKFLOW_EXPORT',
      'The file has no export default workflow(...).',
      { file, start: 0, end: 0 },
      {
        hint: "Add export default workflow('Name', {}, ({ vars }) => { ... }).",
      }
    )
  }

  for (const decl of ctx.decls) {
    if (decl.collisionBase && !ctx.declsByKey.has(decl.collisionBase.base)) {
      reporter.report(
        'E_KEY_OVERRIDE',
        `${decl.key} is a collision key, but no block is keyed ${decl.collisionBase.base}.`,
        rangeOf(ctx, decl.collisionBase.node),
        {
          hint: 'A name~n key only keeps a legacy collision apart; remove meta.key.',
          blockKey: decl.key,
        }
      )
    }
  }

  const overLimit = ctx.decls[limits.maxBlocks]
  if (overLimit) {
    reporter.report(
      'E_LIMIT_EXCEEDED',
      `The workflow declares ${ctx.decls.length} blocks; the limit is ${limits.maxBlocks}.`,
      rangeOf(ctx, overLimit.anchorNode),
      { hint: 'Split the workflow, moving parts into child workflows.' }
    )
    return emptyResult(reporter, parsed.sdkMajor)
  }

  const compiled = new Map<BlockKey, CanonicalBlock>()
  const hints: SourceHints = { blocks: {} }
  for (const decl of ctx.decls) {
    const result = compileBlock(ctx, decl)
    if (!result) continue
    compiled.set(decl.key, result.block)
    setOwn(hints.blocks, decl.key, {
      ...(decl.ident !== null && { ident: decl.ident }),
      order: decl.order,
      ...(result.codeFile !== undefined && { codeFile: result.codeFile }),
    })
  }

  checkCodeFileRefs(ctx)

  const refTypes: RefTypeScope = {
    catalog: input.catalog,
    block: (key) => compiled.get(key),
    variable: (key) => ctx.variables.get(key),
  }
  const isString = (token: string) => refValueKind(token, refTypes) === 'string'
  for (const { params, id, tree, refs } of ctx.jsonFields) {
    setOwn(params, id, { kind: 'value', value: jsonFieldText(tree, isString) })
    for (const ref of refs) {
      if (refValueKind(ref.token, refTypes) !== 'untyped') continue
      reporter.report(
        'W_JSON_REF_UNTYPED',
        `Nothing declares the type of ${ref.token}; it is stored bare, so a string value would break the JSON.`,
        ref.range,
        {
          hint: `Leave it bare when it holds an array, object, number or boolean (it is spliced in as JSON); only when it holds text write t\`\${${text.slice(ref.range.start, ref.range.end)}}\`.`,
          blockKey: ref.blockKey,
        }
      )
    }
  }

  checkResponseFormatRefs(ctx, (key) => compiled.get(key))

  const edges = new EdgeCollector(ctx, compiled)
  for (const entry of ctx.wiring) edges.statement(entry)
  for (const implied of ctx.implied) edges.implied(implied.container, implied.child, implied.body)
  edges.reportCycles(input.stored)
  edges.reportUnwiredBranches(input.stored)
  const erroring = new Set<BlockKey>()
  for (const edge of edges.edges) {
    const source = compiled.get(edge.from)
    if (edge.port.kind === 'error' && source) source.errorPort = true
    if (edge.port.kind === 'error') erroring.add(edge.from)
  }
  checkErrorOutputRefs(ctx, erroring)

  ctx.comments.assign(
    (ast.comments ?? []).filter((comment) => (comment.start ?? 0) >= parsed.headerEnd)
  )
  recordSpan(ctx, { kind: 'footer' }, { start: text.length, end: text.length })

  const spans: Partial<Record<AnchorKey, SourceSpan>> = {}
  for (const [key, span] of ctx.spans) spans[key] = span

  const sortedEdges = [...edges.edges].sort(compareEdges)
  const workflow: CanonicalWorkflow | null =
    reporter.hasErrors || !workflowHeader
      ? null
      : {
          modelVersion: 1,
          meta: workflowHeader,
          blocks: Object.fromEntries(compiled),
          edges: sortedEdges,
          variables: Object.fromEntries(ctx.variables),
          annotations: { comments: ctx.comments.comments },
        }
  return {
    workflow,
    diagnostics: reporter.diagnostics,
    spans,
    hints,
    sdkMajor: parsed.sdkMajor,
    envReferences: [...ctx.envReferences].sort(compareStrings),
  }
}
