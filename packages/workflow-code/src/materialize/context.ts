import type { BlockState } from '@sim/workflow-types/workflow'
import type { BlockCatalog } from '../catalog/types'
import type { MaterializeDiagnosticCode } from '../diagnostics/codes'
import type { Diagnostic } from '../diagnostics/frame'
import type { ResourceKeyResolver, VarKey } from '../model'

/** Server callbacks materialize needs; implemented in `apps/sim/lib/workflows/code/`. */
export interface MaterializeHooks {
  /** A fresh block with editor defaults, wrapping editing/builders. */
  initBlock(input: { id: string; type: string; name: string; triggerMode: boolean }): BlockState
  /** Stored `outputs` for a new or changed block, wrapping `getEffectiveBlockOutputs`. */
  computeOutputs(block: BlockState): BlockState['outputs']
  /** A new UUID for a block, branch row, item or variable. */
  newId(): string
}

/** State shared by the materialize steps of one call. */
export interface MaterializeContext {
  catalog: BlockCatalog
  hooks: MaterializeHooks
  resources?: ResourceKeyResolver
  diagnostics: Diagnostic<MaterializeDiagnosticCode>[]
  /** Variable key → the id it is written as. */
  variableIdByKey: Map<VarKey, string>
}
