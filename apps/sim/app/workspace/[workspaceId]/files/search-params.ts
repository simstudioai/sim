import { createParser, parseAsArrayOf, parseAsString, parseAsStringLiteral } from 'nuqs/server'
import { createSortParams } from '@/lib/url-state'
import {
  WORKSPACE_FILE_KINDS,
  WORKSPACE_FILE_SIZE_BUCKETS,
} from '@/lib/workspace-files/list-filters'
import {
  type WorkspaceFileListParams,
  type WorkspaceFileListSortBy,
  workspaceFileListParams,
} from '@/hooks/queries/utils/workspace-file-keys'
import type { ResourceListPreferenceConfig } from '@/stores/resource-list-preferences'

/**
 * Sortable list columns, matching the `Resource.Options` sort menu: the ones the server pages
 * the list by. Type and owner are not among them — a sort the server cannot apply could only
 * order the rows already loaded, which reads as the whole folder's order and is not.
 */
export const FILE_SORT_COLUMNS = ['name', 'size', 'created', 'updated'] as const

type FileSortColumn = (typeof FILE_SORT_COLUMNS)[number]

/** The server field each sort column pages by. */
const FILE_SORT_FIELDS: Record<FileSortColumn, WorkspaceFileListSortBy> = {
  name: 'name',
  size: 'size',
  created: 'uploadedAt',
  updated: 'updatedAt',
}

/**
 * Parser for the `new` flag. Preserves the prior `?new=1` wire format on
 * serialize while tolerantly accepting the legacy `1`/`true` tokens on parse, so
 * existing shared links keep opening the editor in compose mode.
 */
const parseAsNewFlag = createParser<boolean>({
  parse(value) {
    return value === '1' || value === 'true'
  },
  serialize(value) {
    return value ? '1' : ''
  },
})

/**
 * Co-located, typed URL query-param definitions for the Files feature. The
 * client (`Files`) consumes this typed param definition as the single source of
 * truth.
 *
 * - `folderId` is the currently open folder; it is shareable, bookmarkable, and
 *   navigations between folders belong in the browser history (`history: 'push'`,
 *   the group default).
 * - `new` marks a freshly-created file so the editor opens in compose mode; it is
 *   read once on mount and stripped as the route stabilizes.
 * - `shareFileId` deep-links a file's share dialog open. The modal opens when the
 *   id resolves to a loaded file; closing it clears the param. Opening and
 *   closing the modal use a per-call `{ history: 'replace' }` override so the
 *   dialog toggle does not pollute the back/forward stack (a deep link still
 *   opens it on load).
 */
export const filesParsers = {
  folderId: parseAsString,
  new: parseAsNewFlag.withDefault(false),
  shareFileId: parseAsString,
} as const

/**
 * Shared nuqs options for files query state. Folder navigation is a destination,
 * so the group default lands in the browser history; defaults clear from the URL
 * to keep links clean. Non-navigation writes (the `shareFileId` modal toggle)
 * pass a per-call `{ history: 'replace' }` override so they don't add back-stack
 * entries.
 */
export const filesUrlKeys = {
  history: 'push',
  clearOnDefault: true,
} as const

/**
 * Co-located, typed URL query-param definitions for the Files list's
 * filter/search/sort view-state, grouped separately from the navigation params
 * above because filter writes must never land in the browser history.
 *
 * - `search` is the file/folder name filter. The input is controlled directly
 *   by the nuqs value; only its URL write is debounced via
 *   `useDebouncedSearchSetter` — never written on every keystroke.
 * - `type` filters by file kind (document/image/audio/video); `size` filters by
 *   size bucket (small/medium/large); `uploadedBy` filters by uploader user id
 *   (URL key `uploaded-by`). All three are multi-select arrays.
 */
export const filesFilterParsers = {
  search: parseAsString.withDefault(''),
  type: parseAsArrayOf(parseAsStringLiteral(WORKSPACE_FILE_KINDS)).withDefault([]),
  size: parseAsArrayOf(parseAsStringLiteral(WORKSPACE_FILE_SIZE_BUCKETS)).withDefault([]),
  uploadedBy: parseAsArrayOf(parseAsString).withDefault([]),
} as const

/**
 * `sort` / `dir` follow the shared sort convention (two scalar params). The
 * default (most-recently-updated first) matches the list's default ordering, so
 * a clean URL means the default sort. Folders and files sort as one list, so
 * there is no folder-only ordering that a clean URL would have to encode.
 */
export const filesSortParams = createSortParams(FILE_SORT_COLUMNS, {
  column: 'updated',
  direction: 'desc',
})

const filesFilterUrlKeyMap = { uploadedBy: 'uploaded-by' } as const

export const filesListPreferenceConfig = {
  module: 'files',
  sortColumns: FILE_SORT_COLUMNS,
  filterKeys: ['type', 'size', 'uploadedBy'],
  filterValues: { type: WORKSPACE_FILE_KINDS, size: WORKSPACE_FILE_SIZE_BUCKETS },
  preferenceUrlKeys: filesFilterUrlKeyMap,
  defaultPreference: {
    sort: filesSortParams.default,
    filters: { type: [], size: [], uploadedBy: [] },
  },
} as const satisfies ResourceListPreferenceConfig

/** Filter/search/sort view-state: clean URLs, no back-stack churn. */
export const filesFilterUrlKeys = {
  history: 'replace',
  shallow: true,
  clearOnDefault: true,
  urlKeys: filesFilterUrlKeyMap,
} as const

/**
 * The paged list the Files browser shows for its URL state: the open folder's direct children,
 * or — while a search is typed — matches from every folder, sorted and filtered on the server.
 * Shared by the browser and its server prefetch, so the seeded first page is the page the
 * browser reads.
 */
export function filesBrowserListParams(state: {
  folderId: string | null
  search: string
  sort: FileSortColumn
  dir: 'asc' | 'desc'
  type: readonly (typeof WORKSPACE_FILE_KINDS)[number][]
  size: readonly (typeof WORKSPACE_FILE_SIZE_BUCKETS)[number][]
  uploadedBy: readonly string[]
}): WorkspaceFileListParams {
  const searching = state.search.trim().length > 0
  return workspaceFileListParams({
    ...(searching ? { q: state.search } : { folderId: state.folderId }),
    types: state.type,
    sizes: state.size,
    uploadedBy: state.uploadedBy,
    sortBy: FILE_SORT_FIELDS[state.sort],
    sortOrder: state.dir,
  })
}
