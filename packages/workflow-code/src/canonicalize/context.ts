import type { ResourceKeyResolver } from '../api'
import type { BlockCatalog, CatalogBlock, CatalogSubBlock } from '../catalog/types'
import { catalogBlock as readCatalogBlock } from '../catalog/view'
import type { CanonicalizeDiagnosticCode } from '../diagnostics/codes'
import type { Diagnostic } from '../diagnostics/frame'
import type { BlockKey, VarKey } from '../model'

/** One stored variable in declaration order, as the workflow resolver walks them. */
export interface VariableEntry {
  id: string
  key: VarKey
  normalizedName: string
}

/** State shared by the canonicalize steps of one call. */
export interface CanonContext {
  catalog: BlockCatalog
  resources?: ResourceKeyResolver
  diagnostics: Diagnostic<CanonicalizeDiagnosticCode>[]
  /** Block id → key, every stored block. */
  keyById: Map<string, BlockKey>
  /** Normalized name → key of the block references resolve to (the dot-free winner). */
  referenceKeyByName: Map<string, BlockKey>
  /** Stored variables in declaration order. */
  variables: VariableEntry[]
  /** Variable id → key. */
  variableKeyById: Map<string, VarKey>
}

export function report(context: CanonContext, diagnostic: Diagnostic<CanonicalizeDiagnosticCode>) {
  context.diagnostics.push(diagnostic)
}

export function catalogBlock(context: CanonContext, type: string): CatalogBlock | undefined {
  return readCatalogBlock(context.catalog, type)
}

/** Every catalog declaration of `id` on a block, in declared order (action and trigger copies). */
export function subBlockDeclarations(
  block: CatalogBlock | undefined,
  id: string
): CatalogSubBlock[] {
  return block ? block.subBlocks.filter((subBlock) => subBlock.id === id) : []
}
