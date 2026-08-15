'use client'

import { useMemo, useState } from 'react'
import { Chip, ChipDropdown, Table, type TableColumn, TableIdentityCell } from '@sim/emcn'
import { formatDate } from '@sim/utils/formatting'
import { useQueryStates } from 'nuqs'
import type { OrganizationRoster } from '@/lib/api/contracts/organization'
import type { Member } from '@/lib/workspaces/organization'
import {
  BulkActionDialog,
  BulkActionMenu,
  useBulkAction,
} from '@/app/workspace/[workspaceId]/settings/components/bulk-action'
import { BULK_ACTION_COPY } from '@/app/workspace/[workspaceId]/settings/components/team-management/bulk-actions'
import { ManageAccessModal } from '@/app/workspace/[workspaceId]/settings/components/team-management/components/manage-access-modal'
import {
  ORGANIZATION_ROLE_LABELS,
  type OrganizationRosterRow,
  toOrganizationInvitationRow,
  toOrganizationMemberRow,
} from '@/app/workspace/[workspaceId]/settings/components/team-management/member-rows'
import {
  ORGANIZATION_MEMBER_TABS,
  ORGANIZATION_ROLE_FILTERS,
  ORGANIZATION_ROW_ORDERS,
  type OrganizationMemberTab,
  type OrganizationRoleFilter,
  type OrganizationRowOrder,
  organizationMembersParsers,
  organizationMembersUrlKeys,
} from '@/app/workspace/[workspaceId]/settings/components/team-management/search-params'
import { useSettingsSearch } from '@/app/workspace/[workspaceId]/settings/components/use-settings-search'
import { useCancelInvitation, useRemoveMember } from '@/hooks/queries/organization'

/**
 * Every control here is labelled through the literal union `search-params.ts`
 * owns, so a parser and the control it drives cannot drift: a value added to a
 * parser fails to compile until it is named below.
 */
const TAB_LABELS: Record<OrganizationMemberTab, string> = {
  members: 'Members',
  invitations: 'Pending invitations',
}

const ROLE_FILTER_LABELS: Record<OrganizationRoleFilter, string> = {
  all: 'All roles',
  ...ORGANIZATION_ROLE_LABELS,
}

const ORDER_LABELS: Record<OrganizationRowOrder, string> = {
  newest: 'Newest first',
  oldest: 'Oldest first',
  az: 'A-Z',
  za: 'Z-A',
}

const TABS = ORGANIZATION_MEMBER_TABS.map((id) => ({ id, label: TAB_LABELS[id] }))

const ROLE_FILTER_OPTIONS = ORGANIZATION_ROLE_FILTERS.map((value) => ({
  value,
  label: ROLE_FILTER_LABELS[value],
}))

/**
 * Ownership is never invited — it is set when the organization is created and
 * afterwards only moves through the transfer flow, so the invite contract's
 * membership enum has no `owner` and an invitation row can only ever project to
 * admin / member / external. Offering an Owner filter over invitations would be
 * a control that always returns nothing.
 */
const INVITATION_ROLE_FILTER_OPTIONS = ROLE_FILTER_OPTIONS.filter(
  (option) => option.value !== 'owner'
)

const ORDER_OPTIONS = ORGANIZATION_ROW_ORDERS.map((value) => ({
  value,
  label: ORDER_LABELS[value],
}))

/**
 * Both toolbar filters are pinned to one width so the row does not reflow as a
 * value changes — a trigger that resizes to its label shifts every control
 * beside it on every selection. 130px clears the longest label ("Newest first",
 * 114px) with room to spare, and holds both dropdowns on the same edge.
 */
const FILTER_TRIGGER_WIDTH = 'w-[130px]'

/**
 * Narrows the bare `string` a `ChipDropdown` or the tab strip reports back to the
 * literal union its parser accepts. `undefined` means the control named a value
 * the URL cannot hold, which callers write as `null` — nuqs then clears the param
 * so the filter falls back to its default rather than persisting a dead value.
 */
function pick<T extends string>(values: readonly T[], value: string): T | undefined {
  return values.find((candidate) => candidate === value)
}

interface OrganizationMembersTableProps {
  organizationId: string
  /** Whether the viewer administers the organization. */
  canManage: boolean
  currentUserId: string
  roster: OrganizationRoster | null | undefined
  isLoadingRoster: boolean
  /** Opens the shared removal confirmation, which owns the credential-impact disclosure. */
  onRemoveMember: (member: Member) => void
  /** Opens the shared ownership-transfer dialog. */
  onTransferOwnership: () => void
}

/**
 * The organization roster as one table: accepted members on the first tab,
 * pending organization invitations on the second, filtered by name/email, by
 * role, and ordered by join date. Tabs, filters, and ordering live in the URL;
 * the visible rows are derived from them, never stored.
 *
 * Selection exists only to bulk-remove members. The owner and the viewer's own
 * row are never selectable — both are refused by the removal route, and leaving
 * is a deliberate single-member flow. `isRowSelectable` disables their
 * checkboxes and drops them from the header's counts, so select-all still
 * reaches "all" and toggles back off.
 */
export function OrganizationMembersTable({
  organizationId,
  canManage,
  currentUserId,
  roster,
  isLoadingRoster,
  onRemoveMember,
  onTransferOwnership,
}: OrganizationMembersTableProps) {
  const [filters, setFilters] = useQueryStates(
    organizationMembersParsers,
    organizationMembersUrlKeys
  )
  const [search, setSearch] = useSettingsSearch()
  const [rawSelection, setRawSelection] = useState<string[]>([])
  const [manageRow, setManageRow] = useState<OrganizationRosterRow | null>(null)

  const removeMember = useRemoveMember()
  const cancelInvitation = useCancelInvitation()

  const isMembersTab = filters.tab === 'members'
  const bulkCopy = BULK_ACTION_COPY[filters.tab]
  const query = search.trim()
  const roleFilterOptions = isMembersTab ? ROLE_FILTER_OPTIONS : INVITATION_ROLE_FILTER_OPTIONS
  /**
   * A deep link can still carry `role=owner` onto the invitations tab, where the
   * option no longer exists. Derive the applied value rather than trusting the
   * param, so the dropdown never displays a role it is not filtering by.
   */
  const activeRole = roleFilterOptions.some((option) => option.value === filters.role)
    ? filters.role
    : 'all'

  const rows = useMemo<OrganizationRosterRow[]>(() => {
    const source: OrganizationRosterRow[] = isMembersTab
      ? (roster?.members ?? []).map((member) =>
          toOrganizationMemberRow(member, { canManage, currentUserId })
        )
      : (roster?.pendingInvitations ?? [])
          .filter((invitation) => invitation.kind === 'organization')
          .map((invitation) => toOrganizationInvitationRow(invitation, { canManage }))

    const needle = query.toLowerCase()
    const matching = source.filter((row) => {
      if (activeRole !== 'all' && row.role !== activeRole) return false
      if (!needle) return true
      return row.name.toLowerCase().includes(needle) || row.email.toLowerCase().includes(needle)
    })

    /**
     * Alphabetical sorts read the identity the tab actually shows: a member's
     * name, and an invitation's email — an invitee who has not signed up has no
     * name, so the projection falls back to the email and sorting by `name`
     * would order those rows by a value the row never displays.
     */
    const sortKey = (row: OrganizationRosterRow) => (isMembersTab ? row.name : row.email)

    return matching.sort((a, b) => {
      switch (filters.order) {
        case 'oldest':
          return a.createdAt - b.createdAt
        case 'az':
          return sortKey(a).localeCompare(sortKey(b))
        case 'za':
          return sortKey(b).localeCompare(sortKey(a))
        default:
          return b.createdAt - a.createdAt
      }
    })
  }, [roster, isMembersTab, activeRole, filters.order, query, canManage, currentUserId])

  /**
   * The stored selection is raw user intent; what the table and the bulk action
   * see is this projection onto the rows that are currently visible AND
   * actionable, so a tab or filter change can never leave a hidden row armed for
   * removal.
   */
  const selectedRows = useMemo(() => {
    const armed = new Set(rawSelection)
    return rows.filter((row) => row.selectable && armed.has(row.id))
  }, [rows, rawSelection])

  const selectedIds = useMemo(() => selectedRows.map((row) => row.id), [selectedRows])

  /**
   * One action for both tabs: removing a member and revoking an invitation
   * differ in the call they make per row and in how the result is worded, and
   * nothing else.
   */
  const bulk = useBulkAction({
    copy: bulkCopy,
    rows: selectedRows,
    perform: (row) =>
      row.kind === 'member'
        ? removeMember.mutateAsync({ memberId: row.member.userId, orgId: organizationId })
        : cancelInvitation.mutateAsync({ invitationId: row.invitation.id, orgId: organizationId }),
    onSettled: () => setRawSelection([]),
  })

  const emptyMessage = isLoadingRoster
    ? 'Loading…'
    : query
      ? `No results for “${query}”`
      : activeRole !== 'all'
        ? 'No results match your filters'
        : isMembersTab
          ? 'No members yet'
          : 'No pending invitations'

  /**
   * No column headers: a name over an email, a role word, and a date are each
   * self-evident, so labelling them adds a band of chrome that says nothing the
   * rows do not. The select-all band above still carries the row count.
   */
  const columns: TableColumn<OrganizationRosterRow>[] = [
    {
      key: 'identity',
      cell: (row) => (
        <TableIdentityCell
          primary={row.name}
          /**
           * An invitation to someone who has not signed up yet has no name, so
           * the projection falls back to the email — rendering it again beneath
           * itself would just be the same string twice.
           */
          secondary={row.name === row.email ? undefined : row.email}
          imageSrc={row.image ?? undefined}
        />
      ),
    },
    {
      key: 'role',
      width: 120,
      cell: (row) => ORGANIZATION_ROLE_LABELS[row.role],
    },
    {
      key: 'date',
      align: 'right',
      width: 140,
      cell: (row) => formatDate(new Date(row.createdAt)),
    },
    {
      key: 'access',
      align: 'right',
      width: 160,
      cell: (row) => (
        <Chip variant='border' onClick={() => setManageRow(row)}>
          Manage access
        </Chip>
      ),
    },
  ]

  return (
    <>
      <Table
        aria-label='Organization members'
        rows={rows}
        getRowId={(row) => row.id}
        columns={columns}
        tabs={{
          items: TABS,
          activeId: filters.tab,
          onChange: (value) => setFilters({ tab: pick(ORGANIZATION_MEMBER_TABS, value) ?? null }),
        }}
        toolbar={{
          search: {
            value: search,
            onChange: setSearch,
            placeholder: 'Search by name or email',
          },
          filters: (
            <>
              <ChipDropdown
                value={activeRole}
                options={roleFilterOptions}
                matchTriggerWidth={false}
                className={FILTER_TRIGGER_WIDTH}
                aria-label='Filter by role'
                onChange={(value) =>
                  setFilters({ role: pick(ORGANIZATION_ROLE_FILTERS, value) ?? null })
                }
              />
              <ChipDropdown
                value={filters.order}
                options={ORDER_OPTIONS}
                matchTriggerWidth={false}
                className={FILTER_TRIGGER_WIDTH}
                aria-label='Sort rows'
                onChange={(value) =>
                  setFilters({ order: pick(ORGANIZATION_ROW_ORDERS, value) ?? null })
                }
              />
            </>
          ),
        }}
        selection={
          canManage
            ? {
                selectedIds,
                onSelectionChange: setRawSelection,
                isRowSelectable: (row: OrganizationRosterRow) => row.selectable,
                bulkActions: (
                  <BulkActionMenu
                    copy={bulkCopy}
                    disabled={selectedIds.length === 0}
                    onSelect={bulk.confirm}
                  />
                ),
              }
            : undefined
        }
        empty={emptyMessage}
      />

      {manageRow && (
        <ManageAccessModal
          key={manageRow.id}
          open
          onOpenChange={(open) => {
            if (!open) setManageRow(null)
          }}
          organizationId={organizationId}
          row={manageRow}
          canManage={canManage}
          currentUserId={currentUserId}
          onRemoveMember={onRemoveMember}
          onTransferOwnership={onTransferOwnership}
        />
      )}

      <BulkActionDialog {...bulk.dialogProps} />
    </>
  )
}
