'use client'

import type { BlockVisibilityState } from '@/lib/core/config/block-visibility'
import { notifyBlockOverlayChanged } from '@/blocks/custom/client-overlay'
import { invalidateBlockCaches, registerBlockVisibilityResolver } from '@/blocks/visibility/context'

/**
 * Client-side visibility state, hydrated from `useBlockVisibility` by
 * `BlockVisibilityLoader`. Registered at module load with `null` state so the
 * very first render — including the SSR pass — is fail-closed for `preview`
 * blocks; the post-mount fetch only ever reveals (benign pop-in) or applies a
 * kill switch to an already-public block.
 */
let state: BlockVisibilityState | null = null

registerBlockVisibilityResolver({ current: () => state })

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false
  for (const value of a) if (!b.has(value)) return false
  return true
}

/**
 * Replace the in-scope visibility state, reset registered module caches, and
 * bump the shared block-overlay version so every subscribed consumer re-reads
 * `getAllBlocks()`.
 *
 * No-ops when the incoming state is deep-equal to the current one — React
 * Query refetches deliver fresh-but-identical objects on every poll, and
 * without this guard each poll would thundering-rebuild the toolbar, search,
 * and matcher caches for nothing.
 */
export function hydrateBlockVisibility(next: BlockVisibilityState): void {
  if (
    state &&
    setsEqual(state.revealed, next.revealed) &&
    setsEqual(state.disabled, next.disabled) &&
    setsEqual(state.previewTagged, next.previewTagged)
  ) {
    return
  }
  state = next
  invalidateBlockCaches()
  notifyBlockOverlayChanged()
}
