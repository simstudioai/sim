import { diagnostic } from '../diagnostics'
import type { KindCodec, KindDir, WorkspaceKind } from '../kind'

/**
 * A kind this release cannot read yet: any file in its folder is refused with
 * `E_KIND_UNSUPPORTED`, so a directory never half-applies a kind the server would ignore.
 */
export function unsupportedCodec(kind: WorkspaceKind, dir: KindDir): KindCodec<never> {
  const refuse = (): never => {
    throw new Error(`The ${kind} kind is not supported yet`)
  }
  return {
    kind,
    dir,
    group: (paths) => ({
      groups: new Map(),
      diagnostics:
        paths.length === 0
          ? []
          : [
              diagnostic('E_KIND_UNSUPPORTED', `${dir}/ is not supported by this server yet.`, {
                kind,
                hint: `Remove ${dir}/ or apply with --only to skip it.`,
              }),
            ],
    }),
    parse: refuse,
    print: refuse,
    canonical: refuse,
  }
}
