'use client'

import { useCallback, useEffect } from 'react'
import { parseAsString, useQueryState } from 'nuqs'

/**
 * The open folder of a resource list, in the URL under legacy's `folderId` key. Opening a folder is
 * a destination, so it lands in history and Back walks out of it. A `folderId` that no longer names
 * a folder heals to the root without a history entry once `known` (the complete tree) has resolved,
 * so a dead bookmark never shows an empty page or files new items where nothing can reach them.
 */
export function useFolderParam(known: ReadonlyMap<string, unknown> | null) {
  const [folderId, setParam] = useQueryState(
    'folderId',
    parseAsString.withOptions({ history: 'push', clearOnDefault: true })
  )
  useEffect(() => {
    if (known && folderId && !known.has(folderId)) void setParam(null, { history: 'replace' })
  }, [known, folderId, setParam])
  const setFolderId = useCallback(
    (next: string | null, options?: { history?: 'push' | 'replace' }) =>
      void setParam(next, options),
    [setParam]
  )
  return [folderId, setFolderId] as const
}
