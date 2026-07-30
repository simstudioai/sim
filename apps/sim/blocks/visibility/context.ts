import type { BlockVisibilityState } from '@/lib/core/config/block-visibility'
import type { BlockConfig } from '@/blocks/types'

/**
 * Resolver for the per-viewer block-visibility projection, mirroring the
 * custom-block overlay seam (`@/blocks/custom/overlay`) but deliberately
 * independent of it: visibility is a discovery concern with its own lifecycle,
 * and a separate AsyncLocalStorage composes with `withCustomBlockOverlay`
 * without `store.run` clobbering.
 *
 * Two environment-specific resolvers register here:
 *  - client: module state hydrated from `useBlockVisibility` (see `client.ts`)
 *  - server: an AsyncLocalStorage scoped per request (see `server-context.ts`)
 *
 * This module is isomorphic (no `'use client'`, no `node:` imports) so
 * `@/blocks/registry` stays importable on both sides. When NO resolver state is
 * active, `preview` blocks are still hidden ({@link isHiddenUnder} treats a null
 * state as "nothing revealed") — fail-closed is the default everywhere,
 * including SSR and server paths outside `withBlockVisibility`.
 */
export interface BlockVisibilityResolver {
  current(): BlockVisibilityState | null
}

let resolver: BlockVisibilityResolver | null = null

/** Register (or clear with `null`) the active visibility resolver for this environment. */
export function registerBlockVisibilityResolver(next: BlockVisibilityResolver | null): void {
  resolver = next
}

/** The visibility state in scope, or `null` when none (= nothing revealed, nothing disabled). */
export function overlayVisibility(): BlockVisibilityState | null {
  return resolver?.current() ?? null
}

/**
 * THE single hidden-predicate for block gating — every surface that hides
 * blocks (registry projection, VFS stamp filter, exposed-integration-tools
 * filter, `get_blocks_metadata`) calls this; never restate the rule inline.
 *
 * A block is hidden when it is an unrevealed `preview` block (fail-closed even
 * with a null state) or when the kill switch (`disabled`) names it. Static
 * `hideFromToolbar` is deliberately NOT part of this predicate — callers that
 * need it check it separately.
 */
export function isHiddenUnder(
  vis: BlockVisibilityState | null,
  block: Pick<BlockConfig, 'type' | 'preview'>
): boolean {
  if (block.preview && !vis?.revealed.has(block.type)) return true
  if (vis?.disabled.has(block.type)) return true
  return false
}

/**
 * Registry of non-React module-cache resets (e.g. the tool-operations search
 * index, the integration matcher) fired when the client visibility state
 * changes. Lives here — not in the `'use client'` module — so plain `lib/`
 * modules can register at load time on either side of the server boundary.
 */
const cacheInvalidators = new Set<() => void>()

/** Register a cache reset to run on visibility changes. Returns an unregister fn. */
export function registerBlockCacheInvalidator(fn: () => void): () => void {
  cacheInvalidators.add(fn)
  return () => cacheInvalidators.delete(fn)
}

/** Fire every registered cache reset (called by the client hydrate path). */
export function invalidateBlockCaches(): void {
  for (const fn of cacheInvalidators) fn()
}
