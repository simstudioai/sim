/**
 * Builds the `@/blocks/registry-maps` module shape from a handful of block modules.
 *
 * The real map imports every block module and, through them, the brand icon
 * sheet and every tool the blocks reference — seconds of imports for each test
 * file that unmocks `@/blocks/registry`. A test that exercises the real
 * registry code (`getBlock`, version resolution, the overlay) against one or
 * two specific blocks registers only those:
 *
 * @example
 * ```ts
 * vi.unmock('@/blocks/registry')
 * vi.mock('@/blocks/registry-maps', async () => {
 *   const { partialBlockRegistry } = await import('@sim/testing/mocks/block-registry.mock')
 *   return partialBlockRegistry(await import('@/blocks/blocks/generic_webhook'))
 * })
 * ```
 *
 * Entries are keyed by `type`, which `blocks/blocks.test.ts` pins as equal to
 * the real registry key. A `FooBlockMeta` export sitting next to `FooBlock` is
 * registered under the same key. Sweeps over the whole registry must keep the
 * real map: a partial one would pass vacuously over the blocks it omits.
 */
export function partialBlockRegistry<T extends { type: string }>(
  ...modules: Array<Record<string, unknown>>
): { BLOCK_REGISTRY: Record<string, T>; BLOCK_META_REGISTRY: Record<string, unknown> } {
  const BLOCK_REGISTRY: Record<string, T> = {}
  const BLOCK_META_REGISTRY: Record<string, unknown> = {}
  for (const mod of modules) {
    for (const [exportName, value] of Object.entries(mod)) {
      if (!isBlockLike(value)) continue
      BLOCK_REGISTRY[value.type] = value as T
      const meta = mod[`${exportName}Meta`]
      if (meta !== undefined) BLOCK_META_REGISTRY[value.type] = meta
    }
  }
  return { BLOCK_REGISTRY, BLOCK_META_REGISTRY }
}

function isBlockLike(value: unknown): value is { type: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string' &&
    Array.isArray((value as { subBlocks?: unknown }).subBlocks)
  )
}
