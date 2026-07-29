import { parseAsString } from 'nuqs/server'

/**
 * The open folder on a resource list built on the generic folder engine. Declared here rather
 * than per feature so the surfaces that use the engine share one URL key and one set of
 * semantics, and so a server `createSearchParamsCache` could read the same parser.
 *
 * Files declares its own `?folderId=` in `files/search-params.ts` — same key, same meaning, but
 * it predates this module and has not been converged.
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
