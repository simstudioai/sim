/**
 * Resolves the optional Apify `timeout` query value for the three run tools.
 *
 * Apify documents `0` as "no timeout", so an explicit zero must survive — a
 * plain truthiness guard silently dropped it. A `!= null` guard keeps zero but
 * also admits the empty string: the run tools' timeout params are
 * `visibility: 'user-or-llm'`, so a direct tool call (or an LLM echoing an
 * unset field) can pass `''`, which `.toString()` turns into a bare `timeout=`
 * that Apify rejects. Only a value that is genuinely present is forwarded, and
 * a present value is stringified unchanged so the query stays byte-identical.
 */
export function resolveApifyTimeoutParam(
  value: number | string | null | undefined
): string | undefined {
  if (value == null) return undefined
  if (typeof value === 'string' && value.trim() === '') return undefined
  return String(value)
}
