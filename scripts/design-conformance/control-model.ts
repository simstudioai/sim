import type { NodePath } from '@babel/traverse'
import type * as t from '@babel/types'
import type { RawUse } from '#control-analysis/inventory'
import type { Expr, StaticInputs } from '#control-analysis/static-inputs'
import type { Entry, Finding } from '#design-conformance/model'

export interface SourceEntry extends Entry {
  bytes: number
  kind: string
}
export interface ControlSource {
  entries: SourceEntry[]
  read(entry: Entry): string
  /** Verified source for bounded import ownership analysis, including oversized data modules. */
  readOwnership?(entry: Entry): string
}
export interface Diagnostic {
  file: string
  line: number
  context: string
  reason: string
}
export interface InventoryFinding extends Finding {
  id: string
  observedFrom: string[]
}
export const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
export const regular = (entry: SourceEntry) =>
  entry.kind === 'blob' && /^100(?:644|755)$/.test(entry.mode)

/** Detached source facts share the existing lexical/static resolver, never application execution. */
export interface ControlHooks {
  program?(input: {
    file: string
    path: NodePath<t.Program>
    reference(node: t.Node, path: NodePath): string
  }): void
  jsx?(input: {
    id: string
    file: string
    owner: string
    path: NodePath<t.JSXElement>
    reference(node: t.Node, path: NodePath): string
  }): void
  recipe?(ref: string, base: Expr, config: Expr): void
  complete?(input: {
    resolve(ref: string): string[]
    staticInputs: StaticInputs
    props: Map<string, Expr>
    uses: RawUse[]
  }): void
}
