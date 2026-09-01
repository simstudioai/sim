/**
 * Builds a `@/tools/registry`-shaped map from one service's tool modules.
 *
 * The real registry is ~4,400 tools across ~6,000 modules — 20s+ of imports
 * for every test file that unmocks it. A test that only needs its own
 * service's configs registers a partial one instead:
 *
 * @example
 * ```ts
 * vi.mock('@/tools/registry', async () => {
 *   const { partialToolRegistry } = await import('@sim/testing/mocks/tool-registry.mock')
 *   return { tools: partialToolRegistry(await import('@/tools/pitchbook')) }
 * })
 * ```
 *
 * Registration itself is asserted with `hasToolId` from `@/tools/tool-ids`,
 * which is generated from the registry and kept in sync by `tool-metadata:check`.
 */
export function partialToolRegistry<T extends { id: string }>(
  ...modules: Array<Record<string, unknown>>
): Record<string, T> {
  const tools: Record<string, T> = {}
  for (const mod of modules) {
    for (const value of Object.values(mod)) {
      if (isToolLike(value)) tools[value.id] = value as T
    }
  }
  return tools
}

function isToolLike(value: unknown): value is { id: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { id?: unknown }).id === 'string' &&
    'params' in value
  )
}
