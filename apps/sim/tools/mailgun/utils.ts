import type { MailgunRegion } from '@/tools/mailgun/types'
import { safeUrlPathSegment } from '@/tools/url-path'

/**
 * Mailgun hosts each account in one region, and a domain created in the EU region
 * is only reachable through the EU host (the US host answers 401). Anything other
 * than `eu` resolves to the US host so workflows saved before the region existed
 * keep their behavior.
 * See https://documentation.mailgun.com/docs/mailgun/api-reference/api-overview
 */
export function getMailgunApiBaseUrl(region?: MailgunRegion): string {
  return region === 'eu' ? 'https://api.eu.mailgun.net/v3' : 'https://api.mailgun.net/v3'
}

/** RFC 3986 `pchar` delimiters that `encodeURIComponent` escapes but a path segment may carry literally. */
const LITERAL_PATH_DELIMITERS = /%(24|26|2B|2C|3A|3B|3D|40)/g

/**
 * One Mailgun path segment (domain, list address, storage key). Rejects separators, dot segments
 * and empty values, and escapes `?`, `#` and `%`, while keeping `@`, `+`, `=` and the other
 * delimiters a path segment allows unescaped, so a valid email address or storage key builds the
 * same URL it always did.
 */
export function mailgunPathSegment(value: string, paramName: string): string {
  return safeUrlPathSegment(value, paramName).replace(LITERAL_PATH_DELIMITERS, (escaped) =>
    decodeURIComponent(escaped)
  )
}
