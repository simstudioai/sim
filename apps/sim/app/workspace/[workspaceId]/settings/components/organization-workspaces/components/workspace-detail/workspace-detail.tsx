'use client'

import { useMemo, useState } from 'react'
import { Chip, ChipDropdown, Table, type TableColumn, TableIdentityCell } from '@sim/emcn'
import { ArrowLeft, Plus } from '@sim/emcn/icons'
import { useQueryStates } from 'nuqs'
import { RoleLockTooltip } from '@/components/permissions'
import {
  BulkActionDialog,
  BulkActionMenu,
  useBulkAction,
} from '@/app/workspace/[workspaceId]/settings/components/bulk-action'
import { WORKSPACE_ACCESS_BULK_COPY } from '@/app/workspace/[workspaceId]/settings/components/organization-workspaces/bulk-actions'
import { WorkspaceAccessModal } from '@/app/workspace/[workspaceId]/settings/components/organization-workspaces/components/workspace-access-modal'
import {
  isWorkspaceAccessRemovable,
  rowMatchesQuery,
  WORKSPACE_ACCESS_LABELS,
  type WorkspaceAccessRow,
  type WorkspaceGroup,
  workspaceAccessLabel,
  workspaceAccessLockReason,
} from '@/app/workspace/[workspaceId]/settings/components/organization-workspaces/roster-groups'
import {
  organizationWorkspaceDetailParsers,
  organizationWorkspaceDetailUrlKeys,
  WORKSPACE_ACCESS_FILTERS,
  WORKSPACE_ACCESS_ORDERS,
  WORKSPACE_ACCESS_TABS,
  type WorkspaceAccessFilter,
  type WorkspaceAccessOrder,
  type WorkspaceAccessTab,
} from '@/app/workspace/[workspaceId]/settings/components/organization-workspaces/search-params'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import { useCancelWorkspaceInvitation, useRemoveWorkspaceMember } from '@/hooks/queries/invitations'

/**
 * Every control here is labelled through the literal union `search-params.ts`
 * owns, so a parser and the control it drives cannot drift: a value added to a
 * parser fails to compile until it is named below.
 */
const TAB_LABELS: Record<WorkspaceAccessTab, string> = {
  members: 'Members',
  pending: 'Pending invitations',
}

const ACCESS_FILTER_LABELS: Record<WorkspaceAccessFilter, string> = {
  all: 'All access',
  ...WORKSPACE_ACCESS_LABELS,
}

const ORDER_LABELS: Record<WorkspaceAccessOrder, string> = {
  az: 'A-Z',
  za: 'Z-A',
}

const TABS = WORKSPACE_ACCESS_TABS.map((id) => ({ id, label: TAB_LABELS[id] }))

const ACCESS_FILTER_OPTIONS = WORKSPACE_ACCESS_FILTERS.map((value) => ({
  value,
  label: ACCESS_FILTER_LABELS[value],
}))

const ORDER_OPTIONS = WORKSPACE_ACCESS_ORDERS.map((value) => ({
  value,
  label: ORDER_LABELS[value],
}))

/** Matches the members table, so the two toolbars line up on the same edge. */
const FILTER_TRIGGER_WIDTH = 'w-[130px]'

/** @see the identical helper in the members table — same reason, same shape. */
function pick<T extends string>(values: readonly T[], value: string): T | undefined {
  return values.find((candidate) => candidate === value)
}

interface WorkspaceDetailProps {
  group: WorkspaceGroup
  organizationId: string
  currentUserId: string
  canManage: boolean
  /** The page search, exactly as typed — normalized here for matching. */
  searchTerm: string
  onSearchTermChange: (value: string) => void
  onInvite: () => void
  onBack: () => void
}

/**
 * One workspace's access list: the organization members who belong to it on the
 * first tab, the invitations that will grant access once accepted on the second.
 *
 * Deliberately the members page in miniature — same tabs, same toolbar, same
 * select-all band, same Manage access chip opening the same shape of modal — so
 * that managing who is in a workspace and managing who is in the organization
 * are one thing to learn rather than two.
 */
export function WorkspaceDetail({
  group,
  organizationId,
  currentUserId,
  canManage,
  searchTerm,
  onSearchTermChange,
  onInvite,
  onBack,
}: WorkspaceDetailProps) {
  const [filters, setFilters] = useQueryStates(
    organizationWorkspaceDetailParsers,
    organizationWorkspaceDetailUrlKeys
  )
  const [rawSelection, setRawSelection] = useState<string[]>([])
  const [manageRow, setManageRow] = useState<WorkspaceAccessRow | null>(null)

  const removeMember = useRemoveWorkspaceMember()
  const cancelInvitation = useCancelWorkspaceInvitation()

  const workspaceId = group.workspace.id
  const isMembersTab = filters.tab === 'members'
  const bulkCopy = WORKSPACE_ACCESS_BULK_COPY[filters.tab]
  const query = searchTerm.trim()

  const rows = useMemo<WorkspaceAccessRow[]>(() => {
    const source: WorkspaceAccessRow[] = isMembersTab ? group.members : group.invites

    /**
     * A search that names the workspace itself keeps every row: the user has
     * already narrowed to this workspace, so filtering its people by the same
     * word would empty a list they just asked to see.
     */
    const needle = query.toLowerCase()
    const namesWorkspace = group.workspace.name.toLowerCase().includes(needle)
    const matching = source.filter((row) => {
      if (filters.access !== 'all' && row.access.permission !== filters.access) return false
      return namesWorkspace || rowMatchesQuery(row, needle)
    })

    return matching.sort((a, b) =>
      filters.order === 'za' ? b.name.localeCompare(a.name) : a.name.localeCompare(b.name)
    )
  }, [group, isMembersTab, query, filters.access, filters.order])

  /**
   * The stored selection is raw user intent; what the table and the bulk action
   * see is this projection onto the rows currently visible AND removable, so a
   * tab or filter change can never leave a hidden row armed.
   */
  const selectedRows = useMemo(() => {
    const armed = new Set(rawSelection)
    return rows.filter(
      (row) => isWorkspaceAccessRemovable(row, { canManage, currentUserId }) && armed.has(row.id)
    )
  }, [rows, rawSelection, canManage, currentUserId])

  const selectedIds = useMemo(() => selectedRows.map((row) => row.id), [selectedRows])

  /**
   * Both tabs withdraw access to this workspace alone — a member keeps their
   * organization membership, and an invitation keeps its other grants.
   */
  const bulk = useBulkAction({
    copy: bulkCopy,
    rows: selectedRows,
    perform: (row) =>
      row.kind === 'member'
        ? removeMember.mutateAsync({ userId: row.member.userId, workspaceId, organizationId })
        : cancelInvitation.mutateAsync({
            invitationId: row.invitationId,
            workspaceId,
            organizationId,
          }),
    onSettled: () => setRawSelection([]),
  })

  const emptyMessage = query
    ? `No results for “${query}”`
    : filters.access !== 'all'
      ? 'No results match your filters'
      : isMembersTab
        ? 'No members in this workspace'
        : 'No pending invitations'

  const columns: TableColumn<WorkspaceAccessRow>[] = [
    {
      key: 'identity',
      cell: (row) => (
        <TableIdentityCell
          primary={row.name}
          secondary={row.name === row.email ? undefined : row.email}
          imageSrc={row.image ?? undefined}
        />
      ),
    },
    {
      key: 'access',
      /** Holds "Admin (Organization)" on one line. */
      width: 170,
      /**
       * The level names its own source and carries the tooltip explaining why it
       * is fixed. Without both, a row whose checkbox and dropdown are inert — an
       * organization admin, the billing account — looks broken rather than
       * governed.
       */
      cell: (row) => (
        <RoleLockTooltip reason={workspaceAccessLockReason(row, { canManage, currentUserId })}>
          <span>{workspaceAccessLabel(row.access)}</span>
        </RoleLockTooltip>
      ),
    },
    {
      key: 'manage',
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
      <SettingsPanel
        back={{ text: 'Workspaces', icon: ArrowLeft, onSelect: onBack }}
        title={group.workspace.name}
        actions={
          canManage
            ? [
                {
                  text: 'Invite',
                  icon: Plus,
                  variant: 'primary',
                  onSelect: onInvite,
                },
              ]
            : []
        }
      >
        <Table
          aria-label={`${group.workspace.name} access`}
          rows={rows}
          getRowId={(row) => row.id}
          columns={columns}
          tabs={{
            items: TABS,
            activeId: filters.tab,
            onChange: (value) => setFilters({ tab: pick(WORKSPACE_ACCESS_TABS, value) ?? null }),
          }}
          toolbar={{
            search: {
              value: searchTerm,
              onChange: onSearchTermChange,
              placeholder: 'Search by name or email',
            },
            filters: (
              <>
                <ChipDropdown
                  value={filters.access}
                  options={ACCESS_FILTER_OPTIONS}
                  matchTriggerWidth={false}
                  className={FILTER_TRIGGER_WIDTH}
                  aria-label='Filter by access'
                  onChange={(value) =>
                    setFilters({ access: pick(WORKSPACE_ACCESS_FILTERS, value) ?? null })
                  }
                />
                <ChipDropdown
                  value={filters.order}
                  options={ORDER_OPTIONS}
                  matchTriggerWidth={false}
                  className={FILTER_TRIGGER_WIDTH}
                  aria-label='Sort rows'
                  onChange={(value) =>
                    setFilters({ order: pick(WORKSPACE_ACCESS_ORDERS, value) ?? null })
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
                  isRowSelectable: (row: WorkspaceAccessRow) =>
                    isWorkspaceAccessRemovable(row, { canManage, currentUserId }),
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
      </SettingsPanel>

      {manageRow && (
        <WorkspaceAccessModal
          key={manageRow.id}
          open
          onOpenChange={(open) => {
            if (!open) setManageRow(null)
          }}
          organizationId={organizationId}
          workspaceId={workspaceId}
          row={manageRow}
          canManage={canManage}
          currentUserId={currentUserId}
        />
      )}

      <BulkActionDialog {...bulk.dialogProps} />
    </>
  )
}
