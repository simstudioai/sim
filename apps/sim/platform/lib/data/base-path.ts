/**
 * A path with this zone's base path, for the writes `next/link` and the router cannot prefix: a
 * direct `history` update or a plain anchor.
 */
export function platformUrl(path: string): string {
  return `${process.env.NEXT_PUBLIC_SIM_PLATFORM_BASE_PATH ?? ''}${path}`
}
