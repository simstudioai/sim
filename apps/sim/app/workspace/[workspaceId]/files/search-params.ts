import { createParser, parseAsArrayOf, parseAsString, parseAsStringLiteral } from 'nuqs/server'

/** Sortable list columns, matching the `Resource.Options` sort menu. */
export const FILE_SORT_COLUMNS = ['name', 'size', 'type', 'created', 'owner', 'updated'] as const

export type FileSortColumn = (typeof FILE_SORT_COLUMNS)[number]

const SORT_DIRECTIONS = ['asc', 'desc'] as const

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
 *   by the nuqs value; only its URL write is debounced via `limitUrlUpdates`
 *   (`debounce`) on the setter — never written on every keystroke.
 * - `sort` / `dir` follow the shared sort convention (two scalar params). They
 *   are intentionally nullable (no `.withDefault`) because "no active sort" is
 *   behaviorally distinct from explicitly sorting by the fallback column: with
 *   no sort, files order by updated/desc but folders by name/asc, while an
 *   explicit updated/desc sorts both sections by updatedAt. Collapsing the
 *   explicit selection into a clean URL would make that folder ordering
 *   unreachable. Clearing the sort writes `null`, which strips both params.
 * - `type` filters by file kind (document/image/audio/video); `size` filters by
 *   size bucket (small/medium/large); `uploadedBy` filters by uploader user id
 *   (URL key `uploaded-by`). All three are multi-select arrays.
 */
export const filesFilterParsers = {
  search: parseAsString.withDefault(''),
  sort: parseAsStringLiteral(FILE_SORT_COLUMNS),
  dir: parseAsStringLiteral(SORT_DIRECTIONS),
  type: parseAsArrayOf(parseAsString).withDefault([]),
  size: parseAsArrayOf(parseAsString).withDefault([]),
  uploadedBy: parseAsArrayOf(parseAsString).withDefault([]),
} as const

/** Filter/search/sort view-state: clean URLs, no back-stack churn. */
export const filesFilterUrlKeys = {
  history: 'replace',
  shallow: true,
  clearOnDefault: true,
  urlKeys: { uploadedBy: 'uploaded-by' },
} as const
