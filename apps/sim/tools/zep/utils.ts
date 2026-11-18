import { safeUrlPathSegment } from '@/tools/url-path'

/** Spaces and C0 controls the URL parser trims from the end of a whole URL. */
const URL_TRAILING_TRIM = /[\u0000- ]+$/

/**
 * Encodes a Zep id used mid-path. Ids are opaque, so separators and surrounding whitespace are
 * encoded as given; tabs and newlines are dropped as the URL parser dropped them from raw ids.
 */
export function zepPathSegment(value: string | number, paramName: string): string {
  return safeUrlPathSegment(value, paramName, {
    allowSeparators: true,
    preserveWhitespace: true,
    stripTabsAndNewlines: true,
  })
}

/**
 * Encodes a Zep id that is the last component of the request URL. When these ids were sent raw,
 * the URL parser trimmed their trailing spaces and control characters, so those are trimmed here.
 */
export function zepFinalPathSegment(value: string | number, paramName: string): string {
  const id = typeof value === 'string' ? value.replace(URL_TRAILING_TRIM, '') : value
  return zepPathSegment(id, paramName)
}
