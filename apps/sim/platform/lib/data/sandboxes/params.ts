'use client'

import { useQueryState } from 'nuqs'
import { parseAsString } from 'nuqs/server'

/**
 * The sandbox open in the editor, as legacy's `sandboxId`. Only the id lives in the URL: a stale id
 * from an old link resolves to nothing and falls back to the list. Opening one is a destination, so
 * Back closes it.
 */
export function useSandboxParam() {
  return useQueryState('sandboxId', {
    ...parseAsString,
    history: 'push',
    clearOnDefault: true,
  })
}
