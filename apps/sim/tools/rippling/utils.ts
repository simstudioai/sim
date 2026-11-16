import { isRecordLike } from '@sim/utils/object'

/**
 * The `cursor` query value inside a Rippling `next_link`, so a caller can pass it back as the
 * list tool's `cursor` param. Rippling returns the next page as a full URL
 * (`https://rest.ripplingapis.com/workers/?cursor=...`); null when there is no next page or the
 * link carries no cursor.
 */
export function nextCursorFromLink(nextLink: unknown): string | null {
  if (typeof nextLink !== 'string' || nextLink === '') return null
  try {
    return new URL(nextLink, 'https://rest.ripplingapis.com').searchParams.get('cursor')
  } catch {
    return null
  }
}

/** `?cursor=<cursor>` for a list endpoint that takes no other query params, or `''` without one. */
export function cursorQuery(cursor: string | undefined): string {
  return cursor ? `?${new URLSearchParams({ cursor }).toString()}` : ''
}

/** Each key of `properties` read from a Rippling response object, `null` where the response omits it. */
export function pickOutputFields(
  source: Record<string, unknown>,
  properties: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(Object.keys(properties).map((key) => [key, source[key] ?? null]))
}

/**
 * `value[key]` when `value` is an object already wrapped in the body key the tool adds itself
 * (`{ "draft_hires": [...] }`), else `value`. Older block wand prompts generated the wrapped form,
 * which the tool then wrapped a second time.
 */
export function unwrapBodyKey(value: unknown, key: string): unknown {
  return isRecordLike(value) && key in value ? value[key] : value
}

/**
 * The field values of a custom object record body, keyed by field API name. Accepts an object or
 * a JSON string of one (a tool call can reach the tool with the raw string when the block mapper
 * throws); absent data reads as no fields. Throws on anything else, so a malformed payload fails
 * instead of sending an empty create or a no-op update.
 */
export function customObjectRecordFields(data: unknown): Record<string, unknown> {
  if (data == null || data === '') return {}
  let fields: unknown = data
  if (typeof data === 'string') {
    try {
      fields = JSON.parse(data)
    } catch {
      fields = undefined
    }
  }
  if (!isRecordLike(fields)) {
    throw new Error('data must be a JSON object of field values keyed by field API name')
  }
  return fields
}
