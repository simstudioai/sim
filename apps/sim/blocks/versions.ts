/**
 * The digits of a `_vN` suffix, or `undefined` when the remainder is not a
 * version.
 *
 * Matched by string comparison rather than a `RegExp` built from the caller's
 * type: `GET /api/v2/blocks/{blockId}` accepts any string, so `[`, `(`, `*` or
 * `a{2,1}` would be interpolated into the pattern and throw a `SyntaxError`
 * during compilation — an unclassified 500 on a well-formed request.
 * `tools/tool-ids.ts` resolves the same `_vN` convention the same way.
 */
export function parseVersionSuffix(suffix: string): number | undefined {
  if (!suffix || !/^\d+$/.test(suffix)) return undefined
  const version = Number.parseInt(suffix, 10)
  return Number.isSafeInteger(version) ? version : undefined
}

/**
 * The highest-version `<type>_vN` key among `keys`, for a type already in
 * registry key form. Registry-free, so a display-only reader of generated block
 * names resolves versions exactly as the registry does.
 */
export function latestVersionKey(
  keys: Iterable<string>,
  normalizedType: string
): string | undefined {
  const prefix = `${normalizedType}_v`
  let latestKey: string | undefined
  let latestVersion = -1
  for (const key of keys) {
    if (!key.startsWith(prefix)) continue
    const version = parseVersionSuffix(key.slice(prefix.length))
    if (version !== undefined && version > latestVersion) {
      latestVersion = version
      latestKey = key
    }
  }
  return latestKey
}
