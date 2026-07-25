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

function isEmptyState(vis: BlockVisibilityState): boolean {
  return vis.revealed.size === 0 && vis.disabled.size === 0 && vis.previewTagged.size === 0
}

/**
 * Replace the in-scope visibility state, reset registered module caches, and
 * bump the shared block-overlay version so every subscribed consumer re-reads
 * `getAllBlocks()`.
 *
 * No-ops when the change cannot alter the projection: an incoming state
 * deep-equal to the current one (React Query refetches deliver
 * fresh-but-identical objects on every poll — without this guard each poll
 * would thundering-rebuild the toolbar, search, and matcher caches), or an
 * empty state while none is set (`null` and empty are equivalent for
 * `isHiddenUnder`, so the fail-closed reset on first mount is free).
 */
export function hydrateBlockVisibility(next: BlockVisibilityState): void {
  if (state === null && isEmptyState(next)) return
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

/**
 * Fail-closed reset while a workspace switch's visibility fetch is in flight:
 * preview reveals are dropped immediately (they may not apply to the new
 * workspace), but kill-switch entries are CARRIED OVER until the new
 * projection arrives — dropping `disabled` would flash kill-switched blocks
 * back into discovery for the flight window, while briefly over-hiding in the
 * new workspace is benign in both directions.
 */
export function resetBlockVisibilityForSwitch(): void {
  if (state === null) return
  hydrateBlockVisibility({
    revealed: new Set(),
    disabled: state.disabled,
    previewTagged: new Set(),
  })
}
