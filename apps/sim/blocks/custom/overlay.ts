import type { BlockConfig } from '@/blocks/types'

/**
 * Resolver for dynamic (DB-driven) custom blocks that live outside the static
 * `BLOCK_REGISTRY`. The four core accessors in `@/blocks/registry` fall back to
 * the registered resolver so custom block types resolve everywhere without
 * rewriting the many synchronous `getBlock` call sites.
 *
 * Two environment-specific resolvers register here:
 *  - client: a Map hydrated from `useCustomBlocks` (see `client-overlay.ts`)
 *  - server: an AsyncLocalStorage map scoped per request/org (see `server-overlay.ts`)
 *
 * This module is isomorphic (no `'use client'`, no `node:` imports) so
 * `registry.ts` stays importable on both sides.
 */
export interface BlockOverlayResolver {
  get(type: string): BlockConfig | undefined
  all(): BlockConfig[]
}

let resolver: BlockOverlayResolver | null = null

/** Register (or clear with `null`) the active overlay resolver for this environment. */
export function registerBlockOverlayResolver(next: BlockOverlayResolver | null): void {
  resolver = next
}

/** Resolve a single custom block config by type, or `undefined` when none applies. */
export function resolveOverlayBlock(type: string): BlockConfig | undefined {
  return resolver?.get(type)
}

/** All custom block configs currently in scope (empty when no resolver is active). */
export function overlayBlocks(): BlockConfig[] {
  return resolver?.all() ?? []
}
