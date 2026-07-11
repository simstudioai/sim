import { parseAsString } from 'nuqs/server'

/**
 * Co-located, typed URL query-param definition for the Knowledge Base list's
 * folder navigation. `folderId` is the currently open folder — shareable,
 * bookmarkable, and each navigation between folders is a destination, so it
 * belongs in browser history (`history: 'push'`). This is a separate,
 * single-key group from the page's other filters (search/sort/connector/
 * content/owner), which are local `useState` and intentionally do not touch
 * the URL.
 */
export const knowledgeFolderParsers = {
  folderId: parseAsString,
} as const

export const knowledgeFolderUrlKeys = {
  history: 'push',
  clearOnDefault: true,
} as const
