import { parseAsString } from 'nuqs/server'

/**
 * Co-located, typed URL query-param definitions for the Workflows list (the `/w` route with
 * the org project view on).
 *
 * - `search` is the workflow and folder name filter. The input is controlled directly by the
 *   nuqs value; only its URL write is debounced via `useDebouncedSearchSetter`.
 *
 * The open folder is `?folderId=`, declared once for every foldered surface in
 * `components/folders/search-params.ts` and read through `useFolderNavigation`. It is
 * deliberately not part of this map: folder navigation is a destination (`history: 'push'`),
 * while the search is a filter write that must not churn the back stack.
 *
 * Opening a workflow navigates to the `w/[workflowId]` route, so the open workflow is route
 * state, not query state.
 */
export const workflowsParsers = {
  search: parseAsString.withDefault(''),
} as const

/** Filter/search view-state: clean URLs, no back-stack churn. */
export const workflowsUrlKeys = {
  history: 'replace',
  clearOnDefault: true,
} as const
