import { sniffImageContentType } from '@/lib/uploads/utils/validation'

/** Favicons are a few kilobytes; anything far larger is not one. */
export const MAX_ICON_BYTES = 256 * 1024

const ICO_MAGIC_BYTES = [0x00, 0x00, 0x01, 0x00]

type ProviderResult =
  | { kind: 'hit'; contentType: string }
  | { kind: 'miss' }
  | { kind: 'unavailable' }

/** ICO is the one favicon format the shared raster sniffer doesn't recognize; SVG stays excluded. */
function sniffIconType(bytes: Uint8Array): string | null {
  if (ICO_MAGIC_BYTES.every((byte, index) => bytes[index] === byte)) return 'image/x-icon'
  return sniffImageContentType(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))
}

/**
 * Whether a provider's answer is a real icon. Providers answer a host they have no icon for
 * with a placeholder image under a 404, which a browser `<img>` would show as if it were one;
 * only the status separates the two. Rate limits and server errors are `unavailable`, so an
 * outage is never remembered as "this site has no icon".
 */
export function classifyProviderResponse(status: number, bytes: Uint8Array): ProviderResult {
  if (status === 429 || status >= 500) return { kind: 'unavailable' }
  if (status !== 200 || bytes.length === 0 || bytes.length > MAX_ICON_BYTES) return { kind: 'miss' }
  const contentType = sniffIconType(bytes)
  return contentType ? { kind: 'hit', contentType } : { kind: 'miss' }
}
