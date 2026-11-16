import type { MaterializeHooks, ResourceKeyResolver } from '../api'
import type { BlockCatalog, CatalogBlock } from '../catalog/types'
import { catalogBlock as catalogBlockOf } from '../catalog/view'
import type { MaterializeDiagnosticCode } from '../diagnostics/codes'
import type { Diagnostic } from '../diagnostics/frame'
import type { VarKey } from '../model'

/** State shared by the materialize steps of one call. */
export interface MaterializeContext {
  catalog: BlockCatalog
  hooks: MaterializeHooks
  resources?: ResourceKeyResolver
  diagnostics: Diagnostic<MaterializeDiagnosticCode>[]
  /** Variable key → the id it is written as. */
  variableIdByKey: Map<VarKey, string>
}

export function report(
  context: Pick<MaterializeContext, 'diagnostics'>,
  diagnostic: Diagnostic<MaterializeDiagnosticCode>
): void {
  context.diagnostics.push(diagnostic)
}

export function catalogBlock(
  catalog: BlockCatalog,
  type: string | undefined
): CatalogBlock | undefined {
  return type === undefined ? undefined : catalogBlockOf(catalog, type)
}
