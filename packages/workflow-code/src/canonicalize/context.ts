import type { BlockCatalog } from '../catalog/types'
import type { CanonicalizeDiagnosticCode } from '../diagnostics/codes'
import type { Diagnostic } from '../diagnostics/frame'
import type { BlockKey, ResourceKeyResolver, VarKey } from '../model'

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
  /** The normalized names references resolve by, each its block's key (the dot-free winner). */
  referenceableKeys: ReadonlySet<BlockKey>
  /** Stored variables in declaration order. */
  variables: VariableEntry[]
  /** Variable id → key. */
  variableKeyById: Map<string, VarKey>
}
