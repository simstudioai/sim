/**
 * Intersects integration allowlists from independent policy layers.
 * `null` means unrestricted, while an empty array denies every integration.
 */
export function intersectIntegrationAllowlists(
  first: readonly string[] | null,
  second: readonly string[] | null
): string[] | null {
  const normalizedFirst = first?.map((integration) => integration.toLowerCase()) ?? null
  const normalizedSecond = second?.map((integration) => integration.toLowerCase()) ?? null

  if (normalizedFirst === null) return normalizedSecond
  if (normalizedSecond === null) return normalizedFirst

  const secondSet = new Set(normalizedSecond)
  return normalizedFirst.filter((integration) => secondSet.has(integration))
}
