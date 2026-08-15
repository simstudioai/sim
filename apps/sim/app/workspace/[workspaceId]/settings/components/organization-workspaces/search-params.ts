import { parseAsString, parseAsStringLiteral } from 'nuqs/server'

/**
 * Co-located URL query-param definitions for the organization Workspaces page.
 * The client hooks consume these typed definitions as the single source of
 * truth.
 *
 * `workspace-id` deep-links the page to one workspace's access detail sub-view
 * (mirrors `mcpServerId` on the MCP tab). The id is stored alone — the
 * workspace itself is derived from the loaded roster.
 */
export const organizationWorkspaceIdParam = {
  key: 'workspace-id',
  parser: parseAsString,
} as const

/** Opening a workspace's detail is a destination → push to history; clear on close. */
export const organizationWorkspaceIdUrlKeys = {
  history: 'push',
  clearOnDefault: true,
} as const

/**
 * Ordering of the workspace list. A single scalar rather than the shared
 * `sort` + `dir` pair, for the same reason the members table uses one: column
 * and direction are not independent here, so four values name every reachable
 * state exactly.
 *
 * There is no date ordering because the roster reports a workspace as `{ id,
 * name }` only — offering "Newest first" would sort by a value the row cannot
 * show.
 */
export const ORGANIZATION_WORKSPACE_ORDERS = ['az', 'za', 'most', 'fewest'] as const

export type OrganizationWorkspaceOrder = (typeof ORGANIZATION_WORKSPACE_ORDERS)[number]

/** Tabs inside the workspace detail sub-view. */
export const WORKSPACE_ACCESS_TABS = ['members', 'pending'] as const

export type WorkspaceAccessTab = (typeof WORKSPACE_ACCESS_TABS)[number]

/**
 * Access-level filter inside the workspace detail. `all` is the unfiltered
 * default; the rest mirror the workspace permission enum.
 */
export const WORKSPACE_ACCESS_FILTERS = ['all', 'admin', 'write', 'read'] as const

export type WorkspaceAccessFilter = (typeof WORKSPACE_ACCESS_FILTERS)[number]

/**
 * Ordering inside the workspace detail. Alphabetical only: a workspace grant
 * carries no timestamp, and a member's organization join date would order these
 * rows by a value the workspace view never displays.
 */
export const WORKSPACE_ACCESS_ORDERS = ['az', 'za'] as const

export type WorkspaceAccessOrder = (typeof WORKSPACE_ACCESS_ORDERS)[number]

/**
 * List view-state. Kept separate from the detail's group below so the two
 * orderings cannot collide on one wire key — only one view is mounted at a
 * time, and a stale value carried between them would silently reset.
 */
export const organizationWorkspaceListParsers = {
  order: parseAsStringLiteral(ORGANIZATION_WORKSPACE_ORDERS).withDefault('az'),
} as const

/**
 * Detail view-state: which side of the workspace is showing, filtered by access
 * level and ordered by name. `workspace-tab` is cleared alongside
 * `workspace-id` on close, so it never lingers on the list URL.
 *
 * The name/email filter is the settings-wide `?search=` key, owned by
 * `settingsSearchParam` and consumed through `useSettingsSearch` — deliberately
 * not redeclared here, since two definitions of one wire key drift.
 */
export const organizationWorkspaceDetailParsers = {
  tab: parseAsStringLiteral(WORKSPACE_ACCESS_TABS).withDefault('members'),
  access: parseAsStringLiteral(WORKSPACE_ACCESS_FILTERS).withDefault('all'),
  order: parseAsStringLiteral(WORKSPACE_ACCESS_ORDERS).withDefault('az'),
} as const

/** Wire keys for the detail group — `tab`/`order` are too generic to own bare. */
export const organizationWorkspaceDetailUrlKeys = {
  history: 'replace',
  clearOnDefault: true,
  urlKeys: {
    tab: 'workspace-tab',
    access: 'workspace-access',
    order: 'workspace-order',
  },
} as const

/** List filter view-state: clean URLs, no back-stack churn. */
export const organizationWorkspaceListUrlKeys = {
  history: 'replace',
  clearOnDefault: true,
  urlKeys: { order: 'order' },
} as const
