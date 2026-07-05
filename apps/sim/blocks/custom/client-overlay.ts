'use client'

import { useSyncExternalStore } from 'react'
import { registerBlockOverlayResolver } from '@/blocks/custom/overlay'
import type { BlockConfig } from '@/blocks/types'

/**
 * Client-side custom-block overlay: a mutable Map, hydrated from
 * `useCustomBlocks` by `CustomBlocksProvider`, that the `@/blocks/registry`
 * accessors fall back to. Scoped to the active workspace's org; re-hydrated on
 * workspace switch.
 *
 * Because many consumers snapshot `getAllBlocks()` (the cmd+K search, the Access
 * Control block list), the overlay is also an external store: `version` bumps on
 * every hydrate and listeners are notified, so those consumers can re-read via
 * {@link useCustomBlockOverlayVersion} instead of going stale until a refresh.
 */
let map = new Map<string, BlockConfig>()
let version = 0
const listeners = new Set<() => void>()

registerBlockOverlayResolver({
  get: (type) => map.get(type),
  all: () => [...map.values()],
})

/** Replace the in-scope custom blocks and notify subscribers. */
export function hydrateClientCustomBlocks(configs: BlockConfig[]): void {
  map = new Map(configs.map((config) => [config.type, config]))
  version += 1
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Subscribe a component to overlay changes. Returns a monotonic version that
 * changes on every hydrate — include it in a `useMemo`/`useEffect` dep list to
 * recompute anything derived from `getAllBlocks()` when custom blocks load.
 */
export function useCustomBlockOverlayVersion(): number {
  return useSyncExternalStore(
    subscribe,
    () => version,
    () => 0
  )
}
