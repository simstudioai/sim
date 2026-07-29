import { parseAsString } from 'nuqs/server'

/**
 * The open folder on any resource list built on the generic folder engine
 * (`workflow` / `file` / `knowledge_base` / `table`). Declared once here rather than per
 * feature so every foldered surface shares the same URL key and semantics, and so
 * `useFolderNavigation` and a server `createSearchParamsCache` can read the same parser.
 *
 * Deliberately nullable (no `.withDefault`): a clean URL means the workspace root, which is
 * the only sane default and keeps a shared link short.
 */
export const folderNavParsers = {
  folderId: parseAsString,
} as const

/**
 * Opening a folder is a destination, so it lands in the browser history and Back walks out
 * of the folder. Defaults clear from the URL to keep shared links short.
 */
export const folderNavUrlKeys = {
  history: 'push',
  clearOnDefault: true,
} as const
