import type { KindCodec } from '@sim/workspace-code'
import type { KindAdapter } from '@/lib/workspace-source/types'

/**
 * The adapter of a kind this release cannot apply yet: a managed folder of it is refused with
 * `E_KIND_UNSUPPORTED`, a get skips it, and nothing of it is ever loaded or written.
 */
export function unsupportedAdapter(codec: KindCodec<never>): KindAdapter<never, never> {
  const refuse = (): never => {
    throw new Error(`The ${codec.kind} kind is not supported yet`)
  }
  return {
    codec,
    supported: false,
    load: async () => ({ bound: new Map(), unbound: [] }),
    plan: async () => [],
    authorize: async () => {},
    apply: refuse,
    read: refuse,
  }
}
