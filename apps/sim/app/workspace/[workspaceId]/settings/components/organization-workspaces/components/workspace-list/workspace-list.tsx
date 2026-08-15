'use client'

import { useMemo, useState } from 'react'
import { Chip, ChipDropdown, Table, type TableColumn, TableIdentityCell } from '@sim/emcn'
import { useRouter } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import {
  BulkActionDialog,
  BulkActionMenu,
  useBulkAction,
} from '@/app/workspace/[workspaceId]/settings/components/bulk-action'
import { DELETE_WORKSPACES_COPY } from '@/app/workspace/[workspaceId]/settings/components/organization-workspaces/bulk-actions'
import {
  groupMatchesQuery,
  type WorkspaceGroup,
} from '@/app/workspace/[workspaceId]/settings/components/organization-workspaces/roster-groups'
import {
  ORGANIZATION_WORKSPACE_ORDERS,
  type OrganizationWorkspaceOrder,
  organizationWorkspaceListParsers,
  organizationWorkspaceListUrlKeys,
} from '@/app/workspace/[workspaceId]/settings/components/organization-workspaces/search-params'
import { useDeleteWorkspace } from '@/hooks/queries/workspace'

const ORDER_LABELS: Record<OrganizationWorkspaceOrder, string> = {
  az: 'A-Z',
  za: 'Z-A',
  most: 'Most members',
  fewest: 'Fewest members',
}

const ORDER_OPTIONS = ORGANIZATION_WORKSPACE_ORDERS.map((value) => ({
  value,
  label: ORDER_LABELS[value],
}))

/** Wide enough to hold "Fewest members" without the trigger resizing per selection. */
const FILTER_TRIGGER_WIDTH = 'w-[150px]'

interface WorkspaceListProps {
  groups: WorkspaceGroup[]
  /** The page search, exactly as typed — normalized here for matching. */
  searchTerm: string
  onSearchTermChange: (value: string) => void
  canManage: boolean
  /**
   * The workspace whose settings this page is being viewed from, when there is
   * one. Deletable like any other — but deleting it strands the page, so its
   * removal is what triggers the walk back out to `/workspace`.
   */
  hostWorkspaceId?: string
  onOpen: (workspaceId: string) => void
}

/**
 * Every workspace the organization owns, one row each, with the size of its
 * member list and a control that opens its access detail.
 *
 * Selection exists only to delete workspaces, and every workspace an
 * organization admin can see is selectable — including the one they are
 * standing in. The route owns the real limits: it refuses a viewer without
 * workspace admin, and refuses to delete a viewer's last workspace. Both arrive
 * as a per-row failure in the result toast rather than being guessed at here,
 * because neither is a property of the row — "the only workspace" depends on
 * how many the acting user has left at that moment, which changes as the batch
 * runs.
 */
export function WorkspaceList({
  groups,
  searchTerm,
  onSearchTermChange,
  canManage,
  hostWorkspaceId,
  onOpen,
}: WorkspaceListProps) {
  const [filters, setFilters] = useQueryStates(
    organizationWorkspaceListParsers,
    organizationWorkspaceListUrlKeys
  )
  const [rawSelection, setRawSelection] = useState<string[]>([])

  const router = useRouter()
  const deleteWorkspace = useDeleteWorkspace()

  const query = searchTerm.trim()

  const rows = useMemo(() => {
    const needle = query.toLowerCase()
    const matching = needle ? groups.filter((group) => groupMatchesQuery(group, needle)) : groups

    return [...matching].sort((a, b) => {
      switch (filters.order) {
        case 'za':
          return b.workspace.name.localeCompare(a.workspace.name)
        case 'most':
          return b.members.length - a.members.length
        case 'fewest':
          return a.members.length - b.members.length
        default:
          return a.workspace.name.localeCompare(b.workspace.name)
      }
    })
  }, [groups, query, filters.order])

  /**
   * The stored selection is raw user intent; what the table and the deletion see
   * is this projection onto the rows currently visible, so a search change can
   * never leave a hidden workspace armed for deletion.
   */
  const selectedRows = useMemo(() => {
    if (!canManage) return []
    const armed = new Set(rawSelection)
    /**
     * The workspace hosting this page is deleted LAST.
     *
     * Two reasons, both about the batch running one row at a time. Deleting it
     * mid-batch pulls the page's own ground away while later rows are still in
     * flight, and the route's "only workspace" guard re-counts per request — so
     * putting it last means a "select everything" ends with the others gone and
     * this one refused, leaving the viewer exactly where they are standing
     * rather than stranded on a workspace that no longer exists.
     */
    return rows
      .filter((group) => armed.has(group.workspace.id))
      .sort(
        (a, b) =>
          Number(a.workspace.id === hostWorkspaceId) - Number(b.workspace.id === hostWorkspaceId)
      )
  }, [rows, rawSelection, canManage, hostWorkspaceId])

  const selectedIds = useMemo(() => selectedRows.map((group) => group.workspace.id), [selectedRows])

  const bulk = useBulkAction({
    copy: DELETE_WORKSPACES_COPY,
    rows: selectedRows,
    perform: (group) => deleteWorkspace.mutateAsync({ workspaceId: group.workspace.id }),
    onSettled: ({ succeeded }) => {
      setRawSelection([])
      /**
       * Deleting the workspace this page is hosted by strands it — the host
       * context 403s on its next read and the shell swaps in an access-denied
       * card. Walk out to `/workspace`, which picks the next workspace, or
       * creates one when that was the last.
       */
      if (hostWorkspaceId && succeeded.some((group) => group.workspace.id === hostWorkspaceId)) {
        router.push('/workspace')
      }
    },
  })

  /**
   * No column headers: a workspace name and its member count are self-evident,
   * so labelling them adds a band of chrome that says nothing the rows do not.
   * The count carries its own noun for the same reason — a bare number in a
   * column with no header would be ambiguous.
   */
  const columns: TableColumn<WorkspaceGroup>[] = [
    {
      key: 'workspace',
      cell: (group) => (
        <TableIdentityCell
          primary={group.workspace.name}
          imageSrc={group.workspace.logoUrl ?? undefined}
          color={group.workspace.color ?? undefined}
          subject='resource'
        />
      ),
    },
    {
      key: 'members',
      align: 'right',
      width: 140,
      cell: (group) =>
        `${group.members.length} ${group.members.length === 1 ? 'member' : 'members'}`,
    },
    {
      key: 'open',
      align: 'right',
      width: 160,
      cell: (group) => (
        <Chip variant='border' onClick={() => onOpen(group.workspace.id)}>
          {canManage ? 'Manage access' : 'View access'}
        </Chip>
      ),
    },
  ]

  return (
    <>
      <Table
        aria-label='Organization workspaces'
        rows={rows}
        getRowId={(group) => group.workspace.id}
        columns={columns}
        toolbar={{
          search: {
            value: searchTerm,
            onChange: onSearchTermChange,
            placeholder: 'Search workspaces and members',
          },
          filters: (
            <ChipDropdown
              value={filters.order}
              options={ORDER_OPTIONS}
              matchTriggerWidth={false}
              className={FILTER_TRIGGER_WIDTH}
              aria-label='Sort workspaces'
              onChange={(value) =>
                setFilters({
                  order: ORGANIZATION_WORKSPACE_ORDERS.find((order) => order === value) ?? null,
                })
              }
            />
          ),
        }}
        selection={
          canManage
            ? {
                selectedIds,
                onSelectionChange: setRawSelection,
                bulkActions: (
                  <BulkActionMenu
                    copy={DELETE_WORKSPACES_COPY}
                    disabled={selectedIds.length === 0}
                    onSelect={bulk.confirm}
                  />
                ),
              }
            : undefined
        }
        empty={query ? `No workspaces matching “${query}”` : 'No workspaces in this organization'}
      />

      <BulkActionDialog {...bulk.dialogProps} />
    </>
  )
}
