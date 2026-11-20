/**
 * The state one print shares across its stages: the workflow and catalog it prints, the layout
 * `scope.ts` computes, and the output it collects (imports, code files, diagnostics). Each stage is
 * a set of functions over a {@link PrintContext}, as each compile stage is over `CompileContext`.
 */

import type { BlockCatalog } from '../catalog/types'
import type { PrintDiagnosticCode } from '../diagnostics/codes'
import type { Diagnostic } from '../diagnostics/frame'
import type { RefTypeScope } from '../json-fields'
import { isCodeFilePath } from '../limits'
import type { SourceHints } from '../lock'
import type { BlockKey, CanonicalBlock, CanonicalEdge, CanonicalWorkflow } from '../model'
import { getOwn } from '../records'
import { CommentPlacer } from './comments'
import { RefPrinter, type RefScope } from './refs'
import { breakParentCycles, subflowScope, visibility } from './scope'
import { ValuePrinter } from './values'

interface PrintOptions {
  /** `files`: function code in `functions/` code files (repo mode); `inline`: `js``...``. */
  functionCode: 'inline' | 'files'
}

/** What `printWorkflow` prints: a canonical workflow over a catalog, with optional source hints. */
export interface PrintInput {
  workflow: CanonicalWorkflow
  catalog: BlockCatalog
  hints?: SourceHints
  options: PrintOptions
}

/** One print's shared state; see the module comment. */
export interface PrintContext {
  readonly workflow: CanonicalWorkflow
  readonly catalog: BlockCatalog
  readonly hints: SourceHints
  readonly options: PrintOptions
  readonly diagnostics: Diagnostic<PrintDiagnosticCode>[]
  readonly imports: Set<string>
  usesVars: boolean
  readonly blocks: Map<BlockKey, CanonicalBlock>
  readonly parentOf: Map<BlockKey, BlockKey | null>
  /** Each scope's members in declaration order. */
  readonly scopeMembers: Map<BlockKey | null, BlockKey[]>
  readonly position: Map<BlockKey, number>
  readonly preorder: BlockKey[]
  readonly preorderIndex: Map<BlockKey, number>
  /** Edges by source block, in workflow order. */
  readonly edgesFrom: Map<BlockKey, CanonicalEdge[]>
  idents: Map<BlockKey, string>
  readonly paramNames: Map<BlockKey, string>
  readonly refs: RefPrinter
  readonly values: ValuePrinter
  readonly comments: CommentPlacer
  readonly codeFiles: Array<{ path: string; text: string }>
  readonly codeFileHints: Map<BlockKey, string>
  /**
   * Code-file paths by their case-folded spelling ({@link foldCodePath}), each with the block that
   * holds it. A hinted path is held for its block from the start, so a block printed earlier never
   * takes it, and two paths one case-insensitive disk holds as one never both print.
   */
  readonly codePathOwners: Map<string, BlockKey>
  readonly refTypes: RefTypeScope
}

/** How a case-insensitive disk spells a path: NFC, lower case. */
export function foldCodePath(path: string): string {
  return path.normalize('NFC').toLowerCase()
}

/** The context for printing `input`, with its parent tree built; `layout` fills the rest. */
export function createPrintContext(input: PrintInput): PrintContext {
  const workflow = input.workflow
  const catalog = input.catalog
  const blocks = new Map(Object.entries(workflow.blocks))
  const imports = new Set<string>(['workflow'])
  const scope: RefScope = {
    hasBlock: (key) => blocks.has(key),
    hasVariable: (key) => Object.hasOwn(workflow.variables, key),
    visibility: (from, target) => visibility(ctx, from, target),
    identOf: (key) => ctx.idents.get(key) ?? key,
    subflowScope: (from, kind) => subflowScope(ctx, from, kind),
    use: (name) => imports.add(name),
    useVars: () => {
      ctx.usesVars = true
    },
  }
  const refs = new RefPrinter(scope)
  const ctx: PrintContext = {
    workflow,
    catalog,
    hints: input.hints ?? { blocks: {} },
    options: input.options,
    diagnostics: [],
    imports,
    usesVars: false,
    blocks,
    parentOf: new Map(),
    scopeMembers: new Map(),
    position: new Map(),
    preorder: [],
    preorderIndex: new Map(),
    edgesFrom: new Map(),
    idents: new Map(),
    paramNames: new Map(),
    refs,
    values: new ValuePrinter(
      refs,
      (name) => imports.add(name),
      () => {
        ctx.usesVars = true
      }
    ),
    comments: new CommentPlacer(workflow.annotations.comments),
    codeFiles: [],
    codeFileHints: new Map(),
    codePathOwners: new Map(),
    refTypes: {
      catalog,
      block: (key) => blocks.get(key),
      variable: (key) => getOwn(workflow.variables, key),
    },
  }
  for (const key of blocks.keys()) {
    const hinted = getOwn(ctx.hints.blocks, key)?.codeFile
    if (
      hinted !== undefined &&
      isCodeFilePath(hinted) &&
      !ctx.codePathOwners.has(foldCodePath(hinted))
    ) {
      ctx.codePathOwners.set(foldCodePath(hinted), key)
    }
  }
  for (const [key, block] of blocks) {
    const parent = block.parent === null ? undefined : blocks.get(block.parent)
    ctx.parentOf.set(key, parent?.subflow && block.parent !== null ? block.parent : null)
  }
  breakParentCycles(ctx)
  for (const edge of workflow.edges) {
    const list = ctx.edgesFrom.get(edge.from) ?? []
    list.push(edge)
    ctx.edgesFrom.set(edge.from, list)
  }
  return ctx
}
