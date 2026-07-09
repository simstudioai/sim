import { AsyncLocalStorage } from 'node:async_hooks'
import type { BlockVisibilityState } from '@/lib/core/config/block-visibility'
import { registerBlockVisibilityResolver } from '@/blocks/visibility/context'

/**
 * Server-side visibility context: a per-request AsyncLocalStorage, independent
 * of the custom-block overlay's ALS so `withBlockVisibility` and
 * `withCustomBlockOverlay` nest in either order without clobbering each other.
 *
 * Only copilot/mothership discovery paths establish this scope. Execution entry
 * points (execute route, trigger.dev tasks, schedules/webhooks) never do — so
 * placed preview blocks always serialize and run, and `preview` blocks stay
 * hidden on unscoped discovery reads purely via the static fail-closed default.
 */
const store = new AsyncLocalStorage<BlockVisibilityState>()

registerBlockVisibilityResolver({ current: () => store.getStore() ?? null })

/** Run `fn` with the given visibility state resolvable via the registry accessors. */
export function withBlockVisibility<T>(
  vis: BlockVisibilityState,
  fn: () => Promise<T>
): Promise<T> {
  return store.run(vis, fn)
}
