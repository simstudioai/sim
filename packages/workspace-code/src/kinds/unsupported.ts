import type { KindCodec, KindDir, WorkspaceKind } from '../kind'

/**
 * A kind this release cannot read yet. Its adapter is `supported: false`, so the plan refuses
 * its folder with `E_KIND_UNSUPPORTED` before grouping anything; the codec only names the kind.
 */
export function unsupportedCodec(kind: WorkspaceKind, dir: KindDir): KindCodec<never> {
  const refuse = (): never => {
    throw new Error(`The ${kind} kind is not supported yet`)
  }
  return {
    kind,
    dir,
    group: () => ({ groups: new Map(), diagnostics: [] }),
    parse: refuse,
    print: refuse,
    canonical: refuse,
  }
}
