import { hashKey, type QueryKey } from '@tanstack/react-query'

/**
 * `placeholderData` that keeps the previous key's data on screen only while the new key stays
 * under `scope`, such as a scope tab changing within one workspace. A key outside it (another
 * workspace or organization) starts empty, so a switch never paints the previous owner's rows.
 */
export function keepPreviousDataWithin(scope: QueryKey) {
  const scopeHash = hashKey(scope)
  return <T>(previousData: T | undefined, previousQuery: { queryKey: QueryKey } | undefined) =>
    previousQuery && hashKey(previousQuery.queryKey.slice(0, scope.length)) === scopeHash
      ? previousData
      : undefined
}
