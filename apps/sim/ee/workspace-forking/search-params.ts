import { parseAsString, parseAsStringLiteral } from 'nuqs/server'
import type { ForkActivityFilter, ForkMappingEntry } from '@/lib/api/contracts/workspace-fork'

/**
 * URL view-state for the Forks console, co-located with the feature so the client hooks and any
 * server read share one definition.
 *
 * Everything here is shareable: a copied link reopens the same tab, the same lineage, the same
 * filters, and the same edge — which is the point of a console that spans several workspaces.
 *
 * The literal lists below are restated rather than derived from their Zod schemas because client
 * params must not import Zod, but each one `satisfies` the contract type it mirrors — so adding a
 * kind on the wire and forgetting it here fails to compile.
 */

/** The console's four peer views. */
export const FORK_TABS = ['lineage', 'mappings', 'excluded', 'activity'] as const
export type ForkTab = (typeof FORK_TABS)[number]

/** Resource kinds the mappings matrix can narrow to. `all` leaves it unfiltered. */
export const FORK_RESOURCE_FILTERS = [
  'all',
  'credential',
  'env-var',
  'table',
  'knowledge-base',
  'file',
  'mcp-server',
  'custom-tool',
  'skill',
] as const satisfies readonly ('all' | ForkMappingEntry['kind'])[]
export type ForkResourceFilter = (typeof FORK_RESOURCE_FILTERS)[number]

/** Fork events the Activity view can narrow to. */
export const FORK_EVENT_FILTERS = [
  'all',
  'fork_content_copy',
  'fork_sync',
  'fork_rollback',
] as const satisfies readonly ForkActivityFilter[]

/** Which of the console's views is showing. */
export const forkTabParam = {
  key: 'fork-tab',
  parser: parseAsStringLiteral(FORK_TABS).withDefault('lineage'),
} as const

/** Switching views is in-place state, not a destination — replace, and clear at the default. */
export const forkTabUrlKeys = {
  history: 'replace',
  clearOnDefault: true,
} as const

/**
 * The edge whose sync detail is open, named by its CHILD workspace id — an edge has exactly one
 * child, so that id identifies it without a compound key.
 */
export const forkEdgeIdParam = {
  key: 'fork-edge',
  parser: parseAsString,
} as const

/** Opening an edge is a destination → push to history; clear on close. */
export const forkEdgeIdUrlKeys = {
  history: 'push',
  clearOnDefault: true,
} as const

/**
 * Sync direction on the open edge. Deliberately nullable rather than defaulted to `push`: the
 * detail derives its own default from which side of the edge the viewer is standing on, and a
 * parser default would overwrite that before the workspace is known.
 */
export const forkDirectionParam = {
  key: 'fork-direction',
  parser: parseAsStringLiteral(['push', 'pull'] as const),
} as const

/** Toggling direction is in-place view state → replace history. */
export const forkDirectionUrlKeys = {
  history: 'replace',
  clearOnDefault: true,
} as const

/**
 * The lineage the mappings matrix lays out, named by its root workspace id. Nullable because the
 * default is derived — the root of whichever lineage the current workspace belongs to.
 */
export const forkRootIdParam = {
  key: 'fork-root',
  parser: parseAsString,
} as const

/** Grouped filter state for the console's list views. */
export const forkFilterParsers = {
  resource: parseAsStringLiteral(FORK_RESOURCE_FILTERS).withDefault('all'),
  event: parseAsStringLiteral(FORK_EVENT_FILTERS).withDefault('all'),
} as const

/** Filter view-state: clean URLs, no back-stack churn. */
export const forkFilterUrlKeys = {
  history: 'replace',
  clearOnDefault: true,
  urlKeys: { resource: 'fork-resource', event: 'fork-event' },
} as const
