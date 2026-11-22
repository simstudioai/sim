/**
 * `printWorkflow`: a canonical workflow → one TypeScript source file plus optional function-code
 * files. Output is deterministic: the same input
 * prints byte-identical text, a one-param change touches one line, and the file is a Biome fixed
 * point. This module prints the blocks and the file around them; `scope.ts`, `params.ts`,
 * `tools.ts` and `edges.ts` print the parts.
 */

import { compareStrings } from '@sim/utils/string'
import {
  isReservedWorkflowBlockName,
  normalizeWorkflowBlockName,
  RESPONSE_BLOCK_TYPE,
} from '@sim/workflow-types/workflow'
import { SUBFLOW_DATA_KEYS, SUPERSEDED_CONTAINER_PARAMS } from '../canonicalize/subflows'
import { builderPins } from '../catalog/surface'
import { catalogBlock } from '../catalog/view'
import type { PrintDiagnosticCode } from '../diagnostics/codes'
import type { Diagnostic } from '../diagnostics/frame'
import { branchesAtTopLevel, printsAsElseTrue } from '../forms/condition'
import { readResponseForm } from '../forms/response'
import { printedConfig } from '../forms/subflow'
import { SOURCE_ENTRY_FILE } from '../limits'
import type { SourceHintBlock, SourceHints } from '../lock'
import type { AnchorKey, BlockKey, CanonicalBlock, Json } from '../model'
import { getOwn, setOwn } from '../records'
import { type BlockMetaKey, GENERIC_BUILDER, SDK_MODULE, type TemplateTag } from '../sdk'
import { type AttachedComments, anchors, withComments } from './comments'
import type { PrintContext } from './context'
import { createPrintContext, type PrintInput } from './context'
import { type Doc, group, hardline, ifBreak, indent, join, line, printDoc } from './doc'
import { hasErrorEdge, wiringStatements } from './edges'
import {
  collectParams,
  fieldContext,
  NULL_EXPR,
  paramProperties,
  responseFormParams,
  stringParam,
} from './params'
import { orderDeclarations } from './scope'
import { printKey } from './strings'
import { arrowExpr, type Expr, objectExpr, type Property, type StatementList } from './syntax'
import { findBuilder } from './tools'

/** biome.json's line width. */
const LINE_WIDTH = 100

interface PrintedFile {
  path: string
  text: string
}

interface PrintResult {
  /** The workflow file first, then code files. */
  files: [PrintedFile, ...PrintedFile[]]
  /** Input hints plus an ident, order and code file for every block. */
  hints: SourceHints
  diagnostics: Diagnostic<PrintDiagnosticCode>[]
  /**
   * An upper bound on the depth of the workflow file's Babel syntax tree, the measure compile
   * caps at `SOURCE_LIMITS.maxDepth`: a print under the cap needs no parse to know it fits.
   */
  entryDepth: number
}

function metaProperties(
  ctx: PrintContext,
  block: CanonicalBlock,
  fields: {
    triggerMode?: boolean | undefined
    extra: Property[]
    subflowData?: Record<string, Json>
    branches?: Property[]
  }
): Property[] {
  const meta: Property[] = []
  const add = (key: BlockMetaKey, value: Expr) => meta.push({ key, value })
  const yes: Expr = { doc: 'true', shape: 'literal', depth: 1 }
  if (needsKeyOverride(block)) add('key', ctx.values.string(block.key))
  if (!block.enabled) add('disabled', yes)
  if (block.locked) add('locked', yes)
  if (block.advancedMode) add('advancedMode', yes)
  if (fields.triggerMode !== undefined) {
    add('triggerMode', { doc: String(fields.triggerMode), shape: 'literal', depth: 1 })
  }
  if (block.errorPort && !hasErrorEdge(ctx, block.key)) add('errorPort', yes)
  if (block.retry) add('retry', ctx.values.json({ ...block.retry }))
  if (fields.branches && fields.branches.length > 0) add('branches', objectExpr(fields.branches))
  if (fields.extra.length > 0) add('extra', objectExpr(fields.extra))
  if (fields.subflowData) add('subflowData', ctx.values.json(fields.subflowData))
  return meta
}

/**
 * Branch rows as named keys, plus the meta's per-row title overrides, `title: null` for a row
 * stored with no title, and extra keys.
 */
function branchEntries(
  ctx: PrintContext,
  block: CanonicalBlock
): { entries: Property[]; meta: Property[] } {
  const branches = block.branches
  if (!branches?.rows) return { entries: [], meta: [] }
  const entries: Property[] = []
  const meta: Property[] = []
  const rows = branches.rows
  rows.forEach((row, index) => {
    const value: Expr = printsAsElseTrue(branches.kind, row, index, rows.length)
      ? { doc: 'true', shape: 'literal', depth: 1 }
      : ctx.values.value(row.value, {
          tag: branches.kind === 'condition' ? 'js' : 't',
          from: block.key,
        })
    entries.push({ key: printKey(row.key), value })
    const rowMeta: Property[] = []
    if (row.titleOverride !== undefined) {
      rowMeta.push({ key: 'title', value: ctx.values.string(row.titleOverride) })
    } else if (row.titleMissing) {
      rowMeta.push({ key: 'title', value: NULL_EXPR })
    }
    if (row.extra && Object.keys(row.extra).length > 0) {
      rowMeta.push({ key: 'extra', value: ctx.values.json(row.extra) })
    }
    if (rowMeta.length > 0) meta.push({ key: printKey(row.key), value: objectExpr(rowMeta) })
  })
  return { entries, meta }
}

function blockCall(ctx: PrintContext, block: CanonicalBlock): Expr {
  if (block.subflow) return containerCall(ctx, block)
  const declared = catalogBlock(ctx.catalog, block.type)
  const found = findBuilder(ctx.catalog, block.type, block.triggerMode, (id) =>
    stringParam(block, id)
  )
  const pinned = new Set(builderPins(found?.builder).keys())
  const collected = collectParams(ctx, block, declared, pinned)
  const { extra } = collected
  const form =
    found?.builder.type === RESPONSE_BLOCK_TYPE
      ? readResponseForm(
          block,
          collected.params.map((entry) => entry.key),
          extra.length > 0
        )
      : null
  const params = form ? responseFormParams(ctx, block, form) : collected.params
  const paramProps = paramProperties(ctx, params)
  const extraProps = paramProperties(ctx, extra)
  const branchSpec = declared?.graph.branches
  const { entries: branchProps, meta: branchMeta } = branchEntries(ctx, block)

  let generic = found === null
  let topLevel: Property[] = paramProps
  if (block.branches && branchSpec) {
    const collides = paramProps.some((prop) =>
      branchProps.some((branch) => branch.key === prop.key)
    )
    const atTopLevel = branchesAtTopLevel(branchSpec.kind, !generic)
    if (atTopLevel && !collides) {
      topLevel = [...branchProps, ...paramProps]
    } else {
      if (atTopLevel) generic = true
      topLevel = [
        ...paramProps,
        { key: printKey(branchSpec.subBlockId), value: objectExpr(branchProps) },
      ]
    }
  }
  let triggerMode: boolean | undefined
  if (generic) triggerMode = block.triggerMode ? true : undefined
  else if ((found?.builder.triggerMode === true) !== block.triggerMode)
    triggerMode = block.triggerMode
  const meta = metaProperties(ctx, block, {
    triggerMode,
    extra: extraProps,
    branches: branchMeta,
  })
  const args: Expr[] = []
  let callee = found?.path ?? GENERIC_BUILDER
  if (generic) {
    callee = GENERIC_BUILDER
    args.push(ctx.values.string(block.type))
    if (found) {
      topLevel = paramProperties(
        ctx,
        [...pinned].sort(compareStrings).flatMap((id) => {
          const value = getOwn(block.params, id)
          return value?.kind === 'value'
            ? [
                {
                  key: printKey(id),
                  anchor: anchors.param(block.key, id),
                  value: ctx.values.value(value.value, fieldContext(block, declared)),
                },
              ]
            : []
        })
      ).concat(topLevel)
    }
  }
  args.push(ctx.values.string(block.name), objectExpr(topLevel))
  if (meta.length > 0) args.push(objectExpr(meta))
  return ctx.values.call(callee, args)
}

/**
 * `loop.<type>(name, config, body, meta?)` / `parallel[.<type>](...)`. Config holds the fields
 * the type runs with; the other types' fields are left to the stored workflow. `meta.extra`
 * carries the container's stored params, and `meta.subflowData` the subflow keys of `block.data`
 * canonicalize could not read as config, which the serializer passes on with the container's
 * data.
 */
function containerCall(ctx: PrintContext, block: CanonicalBlock): Expr {
  const spec = block.subflow
  if (!spec) throw new Error('containerCall requires a subflow block')
  const config: Property[] = []
  for (const item of printedConfig(spec)) {
    if (item.value === undefined || !item.printed) continue
    const tag: TemplateTag = item.kind === 'text' ? 'js' : 't'
    config.push({ key: item.key, value: ctx.values.value(item.value, { tag, from: block.key }) })
  }
  const callee =
    spec.kind === 'loop'
      ? `loop.${spec.loopType}`
      : spec.parallelType === undefined
        ? 'parallel'
        : `parallel.${spec.parallelType}`
  const { params, extra } = collectParams(
    ctx,
    block,
    catalogBlock(ctx.catalog, block.type),
    new Set(SUPERSEDED_CONTAINER_PARAMS)
  )
  const subflowData: Record<string, Json> = {}
  for (const [key, value] of Object.entries(block.extra ?? {})) {
    if (SUBFLOW_DATA_KEYS.has(key)) setOwn(subflowData, key, value)
  }
  const meta = metaProperties(ctx, block, {
    extra: paramProperties(ctx, [...params, ...extra]),
    ...(Object.keys(subflowData).length > 0 && { subflowData }),
  })
  const body = scopeStatements(ctx, block.key)
  const args: Expr[] = [
    ctx.values.string(block.name),
    objectExpr(config),
    arrowExpr(ctx.paramNames.get(block.key) ?? 'p', body),
  ]
  if (meta.length > 0) args.push(objectExpr(meta))
  return ctx.values.call(callee, args)
}

/** Declarations then wiring for one scope (the workflow body or a container callback). */
function scopeStatements(ctx: PrintContext, scope: BlockKey | null): StatementList {
  const members = ctx.scopeMembers.get(scope) ?? []
  const calls = members.map((key) => {
    const block = ctx.blocks.get(key)
    return block ? { key, call: blockCall(ctx, block) } : null
  })
  const wiring = wiringStatements(ctx, scope)
  const wiringDocs: Doc[] = []
  // An expression statement over the call; a declaration adds its declarator too.
  let depth = 0
  const seenAnchors = new Set<AnchorKey>()
  wiring.forEach((statement, index) => {
    const attached: AttachedComments = seenAnchors.has(statement.anchor)
      ? { leading: [], trailing: [] }
      : ctx.comments.take(statement.anchor)
    seenAnchors.add(statement.anchor)
    if (index === 0 && scope === null) {
      const wiringComments = ctx.comments.take(anchors.wiring)
      attached.leading.unshift(...wiringComments.leading)
      attached.trailing.push(...wiringComments.trailing)
    }
    wiringDocs.push(withComments(statement.expr.doc, attached))
    depth = Math.max(depth, 1 + statement.expr.depth)
  })
  const declarations: Doc[] = []
  for (const entry of calls) {
    if (!entry) continue
    const { key, call } = entry
    const own = ctx.comments.take(anchors.block(key))
    const moved = ctx.comments.takeOrphans(key)
    const attached: AttachedComments = {
      leading: [...own.leading, ...moved.leading],
      trailing: [...own.trailing, ...moved.trailing],
    }
    declarations.push(
      withComments(['const ', ctx.idents.get(key) ?? key, ' = ', call.doc], attached)
    )
    depth = Math.max(depth, 2 + call.depth)
  }
  if (scope === null && wiring.length === 0) {
    const dangling = ctx.comments.take(anchors.wiring)
    for (const comment of [...dangling.leading, ...dangling.trailing]) wiringDocs.push(comment)
  }
  const docs =
    declarations.length > 0 && wiringDocs.length > 0
      ? [...declarations, '', ...wiringDocs]
      : [...declarations, ...wiringDocs]
  return { docs, depth }
}

function printSource(ctx: PrintContext): PrintResult {
  orderDeclarations(ctx)
  const body = scopeStatements(ctx, null)
  const options: Property[] = []
  const { description } = ctx.workflow.meta
  if (description !== null)
    options.push({ key: 'description', value: ctx.values.string(description) })
  const variables = Object.values(ctx.workflow.variables).sort((a, b) =>
    compareStrings(a.key, b.key)
  )
  if (variables.length > 0) {
    options.push({
      key: 'variables',
      value: objectExpr(
        variables.map((variable) => {
          const fields: Property[] = []
          if (variable.name !== variable.key) {
            fields.push({ key: 'name', value: ctx.values.string(variable.name) })
          }
          fields.push({ key: 'type', value: ctx.values.string(variable.type) })
          fields.push({ key: 'value', value: ctx.values.json(variable.value) })
          const attached = ctx.comments.take(anchors.variable(variable.key))
          return { key: printKey(variable.key), value: objectExpr(fields), ...attached }
        })
      ),
    })
  }
  const callback = arrowExpr(ctx.usesVars ? '{ vars }' : '', body)
  const workflowCall = ctx.values.call('workflow', [
    ctx.values.string(ctx.workflow.meta.name),
    objectExpr(options),
    callback,
  ])

  const header = ctx.comments.take(anchors.header)
  const footer = ctx.comments.take(anchors.footer)
  ctx.comments.dropRemaining()

  // compareStrings is the order Biome's organizeImports keeps import specifiers in.
  const importNames = [...ctx.imports].sort(compareStrings)
  const importLine = group([
    'import {',
    indent([line, join([',', line], importNames)]),
    ifBreak(','),
    line,
    `} from '${SDK_MODULE}'`,
  ])
  const parts: Doc[] = [
    `// @sim-sdk ${ctx.catalog.sdkMajor}`,
    hardline,
    withComments(importLine, header),
    hardline,
    hardline,
    'export default ',
    workflowCall.doc,
    footer.trailing,
  ]
  if (footer.leading.length > 0) parts.push(hardline, join(hardline, footer.leading))
  parts.push(hardline)
  const text = printDoc(parts, LINE_WIDTH)

  const hintBlocks: Record<BlockKey, SourceHintBlock> = { ...ctx.hints.blocks }
  ctx.preorder.forEach((key, index) => {
    const codeFile = ctx.codeFileHints.get(key)
    setOwn(hintBlocks, key, {
      ident: ctx.idents.get(key) ?? key,
      order: index,
      ...(codeFile ? { codeFile } : {}),
    })
  })
  return {
    files: [{ path: SOURCE_ENTRY_FILE, text }, ...ctx.codeFiles],
    hints: { blocks: hintBlocks },
    diagnostics: [...ctx.refs.diagnostics, ...ctx.diagnostics, ...ctx.comments.diagnostics],
    // File, Program, then the default export over the workflow call; the import line is
    // File, Program, ImportDeclaration, ImportSpecifier, Identifier.
    entryDepth: Math.max(5, 3 + workflowCall.depth),
  }
}

/**
 * A legacy key the display name cannot carry: a `name~n` collision key, or a reserved name
 * (`Loop`, `Parallel`). Printed as `meta.key`, which the compiler accepts only for a key the
 * stored workflow already has (`CompileInput.knownKeys`).
 */
function needsKeyOverride(block: CanonicalBlock): boolean {
  return (
    block.key !== normalizeWorkflowBlockName(block.name) || isReservedWorkflowBlockName(block.key)
  )
}

/**
 * Prints a CWM as a source file. Its output always compiles with zero errors: a block
 * whose type has no catalog builder prints through `block(type, name, params, meta?)`.
 */
export function printWorkflow(input: PrintInput): PrintResult {
  return printSource(createPrintContext(input))
}
