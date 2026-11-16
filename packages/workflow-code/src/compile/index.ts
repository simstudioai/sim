import type { ArrowFunctionExpression, CallExpression, Node } from '@babel/types'
import { compareStrings } from '@sim/utils/string'
import { normalizeWorkflowBlockName } from '@sim/workflow-types/workflow'
import { encodeAnchor, portKey } from '../anchors'
import type { CompileResult, CompileWorkflowFn, LockHints } from '../api'
import type { SourceSpan } from '../diagnostics/frame'
import type {
  AnchorKey,
  BlockKey,
  CanonicalBlock,
  CanonicalVariable,
  CanonicalWorkflow,
  SubBlockId,
  VarKey,
} from '../model'
import { compileBlock } from './blocks'
import { CommentCollector } from './comments'
import { type CompileContext, rangeOf, recordSpan, type Scope } from './context'
import { EdgeCollector } from './edges'
import { didYouMean, HINTS, hintForNode } from './hints'
import { DEFAULT_LIMITS, parseWorkflowSource } from './parse'
import { Reporter } from './report'
import { collectBody } from './scope'
import { compileJsonLiteral, literalText, objectEntries, setOwn } from './values'

const SDK_MODULE = '@sim/workflow-sdk'
const VARIABLE_TYPES: ReadonlySet<string> = new Set([
  'string',
  'number',
  'boolean',
  'object',
  'array',
  'plain',
])
const WORKFLOW_OPTIONS = ['description', 'variables']

function unsupported(ctx: CompileContext, node: Node, message: string, hint: string): void {
  ctx.reporter.report('E_UNSUPPORTED_SYNTAX', message, rangeOf(ctx, node), { hint })
}

/** Module scope: the SDK's named imports (s3 §4 "Accepted grammar"). */
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
    scope.bindings.set(specifier.local.name, { kind: 'sdk', name: imported })
  }
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
    let type: string | null = null
    let value: CanonicalVariable['value'] | undefined
    for (const [field, fieldProperty] of objectEntries(ctx, declaration)) {
      if (field === 'type') {
        type = literalText(fieldProperty.value)
        if (type === null || !VARIABLE_TYPES.has(type)) {
          unsupported(
            ctx,
            fieldProperty.value,
            'Unknown variable type.',
            `Types are ${[...VARIABLE_TYPES].join(', ')}.`
          )
          type = null
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
        } else {
          name = text
        }
      } else if (field === 'value') {
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
    if (type === null || value === undefined) {
      if (type !== null)
        unsupported(ctx, declaration, 'A variable needs a value.', "Write value: ''.")
      continue
    }
    ctx.variables.set(key, { key, name, type: type as CanonicalVariable['type'], value })
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
          const hint = didYouMean(key, WORKFLOW_OPTIONS)
          ctx.reporter.report(
            'E_UNKNOWN_PARAM',
            `${key} is not a workflow option.`,
            rangeOf(ctx, property),
            {
              ...(hint !== undefined && { hint }),
            }
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
  collectBody(ctx, bodyNode.body.body, scope, bodyNode.body, {
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
  }
}

/**
 * Statically interprets a workflow source file into the canonical model (s3 D2). Pass 1 collects
 * imports and every block declaration, nested bodies included; pass 2 evaluates values,
 * references, branches and wiring against the catalog. Nothing in the file is executed: values are
 * read from literal syntax only, and anything else is a located diagnostic.
 */
export const compileWorkflow: CompileWorkflowFn = (input) => {
  const limits = { ...DEFAULT_LIMITS, ...input.limits }
  const file = input.entry.path
  const text = input.entry.text
  const reporter = new Reporter()
  reporter.addFile(file, text)

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
  }
  const ast = parsed.ast
  if (!ast) return emptyResult(reporter, parsed.sdkMajor)

  const ctx: CompileContext = {
    file,
    text,
    reporter,
    catalog: input.catalog,
    files: input.files,
    limits,
    comments: new CommentCollector(file, reporter),
    decls: [],
    declsByKey: new Map(),
    declsByBinding: new Map(),
    variables: new Map(),
    wiring: [],
    implied: [],
    spans: new Map(),
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
    unsupported(ctx, statement, `${statement.type} is not allowed at the top level.`, hint)
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

  const compiled = new Map<BlockKey, CanonicalBlock>()
  const inactive: Record<BlockKey, SubBlockId[]> = {}
  const hints: LockHints = { blocks: {} }
  for (const decl of ctx.decls) {
    const result = compileBlock(ctx, decl)
    if (!result) continue
    compiled.set(decl.key, result.block)
    if (result.inactive.length > 0) setOwn(inactive, decl.key, result.inactive)
    setOwn(hints.blocks, decl.key, {
      ...(decl.binding !== null && { binding: decl.binding }),
      order: decl.order,
      ...(result.codeFile !== undefined && { codeFile: result.codeFile }),
    })
  }

  const edges = new EdgeCollector(ctx, compiled)
  for (const entry of ctx.wiring) edges.statement(entry)
  for (const implied of ctx.implied) edges.implied(implied.container, implied.child, implied.body)
  for (const edge of edges.edges) {
    const source = compiled.get(edge.from)
    if (edge.port.kind === 'error' && source) source.errorPort = true
  }

  ctx.comments.assign(
    (ast.comments ?? []).filter((comment) => (comment.start ?? 0) >= parsed.headerEnd)
  )
  recordSpan(ctx, { kind: 'footer' }, { start: text.length, end: text.length })

  const spans: Partial<Record<AnchorKey, SourceSpan>> = {}
  for (const [key, span] of ctx.spans) spans[key] = span

  const sortedEdges = [...edges.edges].sort(
    (a, b) =>
      compareStrings(a.from, b.from) ||
      compareStrings(portKey(a.port), portKey(b.port)) ||
      compareStrings(a.to, b.to)
  )
  const workflow: CanonicalWorkflow | null =
    reporter.hasErrors || !workflowHeader
      ? null
      : {
          modelVersion: 1,
          meta: workflowHeader,
          blocks: Object.fromEntries(compiled),
          edges: sortedEdges,
          variables: Object.fromEntries(ctx.variables),
          annotations: { inactive, comments: ctx.comments.comments },
        }
  return { workflow, diagnostics: reporter.diagnostics, spans, hints, sdkMajor: parsed.sdkMajor }
}
