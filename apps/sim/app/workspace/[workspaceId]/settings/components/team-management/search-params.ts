import { parseAsStringLiteral } from 'nuqs/server'

/** Tabs of the organization members table. `TABS` in the table labels this same list. */
export const ORGANIZATION_MEMBER_TABS = ['members', 'invitations'] as const

export type OrganizationMemberTab = (typeof ORGANIZATION_MEMBER_TABS)[number]

/** Role filter values. `all` is the unfiltered default. */
export const ORGANIZATION_ROLE_FILTERS = ['all', 'owner', 'admin', 'member', 'external'] as const

export type OrganizationRoleFilter = (typeof ORGANIZATION_ROLE_FILTERS)[number]

/**
 * Row ordering. A single scalar rather than the shared `sort` + `dir` pair
 * because column and direction are not independent here: the table offers one
 * date ordering and one alphabetical ordering, so four values name every
 * reachable state exactly, where a column/direction pair would also admit
 * combinations the UI never offers.
 *
 * `az`/`za` sort by the identity the tab actually shows — a member's name, and a
 * pending invitation's email, since an invitee who has not signed up has no name.
 */
export const ORGANIZATION_ROW_ORDERS = ['newest', 'oldest', 'az', 'za'] as const

export type OrganizationRowOrder = (typeof ORGANIZATION_ROW_ORDERS)[number]

/**
 * Co-located, typed URL query-param definitions for the organization members
 * table.
 *
 * - `tab` picks accepted members or pending organization invitations.
 * - `role` filters by organization role.
 * - `order` orders rows by join/invite date or alphabetically.
 * - The name/email filter is the settings-wide `?search=` key, owned by
 *   `settingsSearchParam` and consumed through `useSettingsSearch` — it is
 *   deliberately not redeclared here (two definitions of one wire key drift).
 */
export const organizationMembersParsers = {
  tab: parseAsStringLiteral(ORGANIZATION_MEMBER_TABS).withDefault('members'),
  role: parseAsStringLiteral(ORGANIZATION_ROLE_FILTERS).withDefault('all'),
  order: parseAsStringLiteral(ORGANIZATION_ROW_ORDERS).withDefault('newest'),
} as const

/** Tab/filter/order view-state: clean URLs, no back-stack churn. */
export const organizationMembersUrlKeys = {
  history: 'replace',
  clearOnDefault: true,
} as const
