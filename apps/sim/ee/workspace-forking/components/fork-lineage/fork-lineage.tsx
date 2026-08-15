'use client'

import { useMemo, useState } from 'react'
import { Badge, Chip, ChipConfirmModal, TableIdentityCell, toast } from '@sim/emcn'
import { TriangleAlert } from '@sim/emcn/icons'
import { getErrorMessage } from '@sim/utils/errors'
import { formatRelativeTime } from '@sim/utils/formatting'
import { useRouter } from 'next/navigation'
import type { ForkForestNode, ForkUndoableRun } from '@/lib/api/contracts/workspace-fork'
import {
  BulkActionDialog,
  BulkActionMenu,
  useBulkAction,
} from '@/app/workspace/[workspaceId]/settings/components/bulk-action'
import { RowActionsMenu } from '@/app/workspace/[workspaceId]/settings/components/row-actions-menu'
import { DISCONNECT_FORKS_COPY } from '@/ee/workspace-forking/components/fork-lineage/bulk-actions'
import {
  buildForkLineageRows,
  type ForkLineageRow,
} from '@/ee/workspace-forking/components/fork-lineage/lineage-rows'
import { ForkTable, type ForkTableColumn } from '@/ee/workspace-forking/components/fork-table'
import { useRollbackFork, useUnlinkFork } from '@/ee/workspace-forking/hooks/workspace-fork'

/** Explains a disabled action whose target workspace the viewer cannot open. */
const NO_ACCESS_TOOLTIP = "You don't have access to this workspace"

/** Wide enough for "12 unmapped" without the column reflowing as counts change. */
const MAPPINGS_COLUMN_WIDTH = 140
const WORKFLOWS_COLUMN_WIDTH = 120
const LAST_SYNC_COLUMN_WIDTH = 120
const ACTIONS_COLUMN_WIDTH = 120

/** The mapping badge for a node's parent edge, or null on a root, which has no edge. */
function edgeBadge(node: ForkForestNode) {
  if (!node.edge) return null
  const { mapped, unmapped } = node.edge
  if (mapped + unmapped === 0) {
    return { label: 'No mappings', variant: 'gray-secondary' as const }
  }
  if (unmapped === 0) return { label: `${mapped} mapped`, variant: 'green' as const }
  return { label: `${unmapped} unmapped`, variant: 'amber' as const }
}

interface ForkLineageProps {
  /** The workspace the console is open in, marked in the tree so its position is never in doubt. */
  workspaceId: string
  nodes: ForkForestNode[]
  loading: boolean
  searchTerm: string
  /** Opens an edge's sync detail, named by the edge's child workspace. */
  onOpenEdge: (childWorkspaceId: string) => void
}

/**
 * Every fork lineage the viewer can reach, as one tree.
 *
 * Rows are the forest in depth-first order with the sidebar's tree rails, so a chain reads as a
 * chain rather than as a parent list and a fork list that have to be reconciled by eye. Each row
 * carries its own parent edge: the mapping state it has stored, when it last synced, and the
 * actions that edge supports.
 */
export function ForkLineage({
  workspaceId,
  nodes,
  loading,
  searchTerm,
  onOpenEdge,
}: ForkLineageProps) {
  const router = useRouter()
  const rollback = useRollbackFork()
  const unlink = useUnlinkFork()

  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [confirmUnlink, setConfirmUnlink] = useState<ForkLineageRow | null>(null)
  const [confirmUndo, setConfirmUndo] = useState<{ node: ForkForestNode; run: ForkUndoableRun }>()

  const query = searchTerm.trim().toLowerCase()
  const rows = useMemo(
    () =>
      buildForkLineageRows(
        nodes,
        query ? (node) => node.name.toLowerCase().includes(query) : undefined
      ),
    [nodes, query]
  )

  /**
   * Disconnect severs the edge a row hangs off, so only rows that HAVE a parent in view can be
   * selected — and only where the viewer administers this side, which is all the route requires.
   */
  const isRowSelectable = (row: ForkLineageRow) => row.parent !== null && row.node.viewerCanAdmin

  const selectedRows = useMemo(() => {
    const armed = new Set(selectedIds)
    return rows.filter((row) => isRowSelectable(row) && armed.has(row.node.id))
  }, [rows, selectedIds])

  const bulk = useBulkAction({
    copy: DISCONNECT_FORKS_COPY,
    rows: selectedRows,
    // `isRowSelectable` already refused any row without a parent, so the edge is always resolvable.
    perform: (row) =>
      unlink.mutateAsync({
        workspaceId: row.node.id,
        body: { otherWorkspaceId: row.parent?.id ?? row.node.parentId ?? '' },
      }),
    onSettled: () => setSelectedIds([]),
  })

  const runUnlink = async () => {
    if (!confirmUnlink?.parent) return
    try {
      await unlink.mutateAsync({
        workspaceId: confirmUnlink.node.id,
        body: { otherWorkspaceId: confirmUnlink.parent.id },
      })
      toast.success(`Disconnected "${confirmUnlink.node.name}" from "${confirmUnlink.parent.name}"`)
      setConfirmUnlink(null)
    } catch (error) {
      toast.error(getErrorMessage(error, 'Disconnect failed'))
    }
  }

  const runUndo = async () => {
    if (!confirmUndo) return
    const { node, run } = confirmUndo
    try {
      const result = await rollback.mutateAsync({
        workspaceId: node.id,
        body: { otherWorkspaceId: run.otherWorkspaceId },
      })
      if (result.pendingActivations.length > 0) {
        toast.warning(`Undid the last sync into "${node.name}"`, {
          description: `${result.pendingActivations.length} restored deployment(s) are still activating. Undo stays available until they finish, in case a retry is needed.`,
        })
      } else {
        toast.success(`Undid the last sync into "${node.name}"`)
      }
      setConfirmUndo(undefined)
    } catch (error) {
      toast.error(getErrorMessage(error, 'Undo failed'))
    }
  }

  const columns: ForkTableColumn<ForkLineageRow>[] = [
    {
      key: 'workspace',
      header: 'Workspace',
      cell: ({ node }) => (
        <TableIdentityCell
          primary={node.name}
          secondary={node.id === workspaceId ? 'You are here' : undefined}
          imageSrc={node.logoUrl ?? undefined}
          color={node.color ?? undefined}
          subject='resource'
        />
      ),
    },
    {
      key: 'workflows',
      header: 'Workflows',
      width: WORKFLOWS_COLUMN_WIDTH,
      cell: ({ node }) => (
        <span className='text-[var(--text-muted)] tabular-nums'>
          {node.deployedWorkflowCount} deployed
        </span>
      ),
    },
    {
      key: 'mappings',
      header: 'Mappings',
      width: MAPPINGS_COLUMN_WIDTH,
      cell: ({ node }) => {
        const badge = edgeBadge(node)
        if (!badge) return <span className='text-[var(--text-subtle)]'>Root workspace</span>
        return (
          <Badge variant={badge.variant} size='sm' dot>
            {badge.label}
          </Badge>
        )
      },
    },
    {
      key: 'last-sync',
      header: 'Last sync',
      width: LAST_SYNC_COLUMN_WIDTH,
      cell: ({ node }) => (
        <span className='text-[var(--text-muted)]'>
          {node.edge?.lastSyncAt ? formatRelativeTime(node.edge.lastSyncAt) : 'Never'}
        </span>
      ),
    },
    {
      key: 'actions',
      align: 'right',
      width: ACTIONS_COLUMN_WIDTH,
      cell: (row) => {
        const { node, parent } = row
        const undoableRun = node.edge?.undoableRun ?? null
        // Editing or running a sync needs admin on BOTH sides, which is what the mapping and
        // promote routes enforce; offering it anywhere else would only produce a 403.
        const canSync = Boolean(parent && node.viewerCanAdmin && parent.viewerCanAdmin)
        return (
          <div className='flex items-center justify-end gap-1'>
            {canSync ? (
              <Chip variant='border' onClick={() => onOpenEdge(node.id)}>
                Sync
              </Chip>
            ) : null}
            <RowActionsMenu
              label={`Actions for ${node.name}`}
              actions={[
                {
                  label: 'Open workspace',
                  onSelect: () => router.push(`/workspace/${node.id}/w`),
                  disabled: !node.viewerAccessible,
                  tooltip: node.viewerAccessible ? undefined : NO_ACCESS_TOOLTIP,
                },
                ...(undoableRun
                  ? [
                      {
                        label: 'Undo last sync',
                        onSelect: () => setConfirmUndo({ node, run: undoableRun }),
                        disabled: !node.viewerCanAdmin,
                        tooltip: node.viewerCanAdmin
                          ? `Restores every workflow "${undoableRun.otherName}" last synced into this workspace to its prior deployed version.`
                          : NO_ACCESS_TOOLTIP,
                      },
                    ]
                  : []),
                // Disconnect stays available regardless of access to the OTHER side: severing the
                // edge is an operation on this workspace, and it must remain reachable exactly
                // when the other side has become unreachable.
                ...(parent
                  ? [
                      {
                        label: 'Disconnect',
                        destructive: true,
                        onSelect: () => setConfirmUnlink(row),
                        disabled: !node.viewerCanAdmin,
                        tooltip: node.viewerCanAdmin ? undefined : NO_ACCESS_TOOLTIP,
                      },
                    ]
                  : []),
              ]}
            />
          </div>
        )
      },
    },
  ]

  return (
    <>
      <ForkTable
        aria-label='Fork lineages'
        rows={rows}
        getRowId={(row) => row.node.id}
        columns={columns}
        getRowRails={(row) => row.rails}
        loading={loading}
        selection={{
          selectedIds,
          onSelectionChange: setSelectedIds,
          isRowSelectable,
          bulkActions: (
            <BulkActionMenu
              copy={DISCONNECT_FORKS_COPY}
              disabled={selectedRows.length === 0}
              onSelect={bulk.confirm}
            />
          ),
        }}
        empty={
          query
            ? `No workspaces matching “${searchTerm.trim()}”`
            : 'No forks yet. Create one to start syncing deployed workflows between workspaces.'
        }
      />

      <ChipConfirmModal
        open={confirmUnlink !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmUnlink(null)
        }}
        srTitle='Disconnect fork'
        title='Disconnect fork'
        text={[
          'This permanently removes the fork relationship between ',
          { text: confirmUnlink?.node.name ?? '', bold: true },
          ' and ',
          { text: confirmUnlink?.parent?.name ?? '', bold: true },
          '. Both workspaces stay exactly as they are, but they no longer appear in each other’s lineage and syncing between them stops.',
        ]}
        confirm={{
          label: 'Disconnect',
          onClick: () => void runUnlink(),
          pending: unlink.isPending,
          pendingLabel: 'Disconnecting...',
        }}
      >
        <div className='flex items-start gap-1.5 px-2 text-[var(--text-secondary)] text-caption'>
          <TriangleAlert className='mt-[1px] size-[14px] shrink-0' />
          <span>
            This cannot be undone. The saved mappings and sync history for this pair are deleted,
            and forking again creates a brand-new workspace.
          </span>
        </div>
      </ChipConfirmModal>

      <ChipConfirmModal
        open={confirmUndo !== undefined}
        onOpenChange={(open) => {
          if (!open) setConfirmUndo(undefined)
        }}
        srTitle='Undo last sync'
        title='Undo last sync'
        text={[
          'This restores every workflow in ',
          { text: confirmUndo?.node.name ?? '', bold: true },
          ' to its ',
          { text: 'prior deployed version', bold: true },
          ' and removes the workflows that sync created. Continue?',
        ]}
        confirm={{
          label: 'Undo sync',
          onClick: () => void runUndo(),
          pending: rollback.isPending,
          pendingLabel: 'Undoing...',
        }}
      >
        <div className='flex items-start gap-1.5 px-2 text-[var(--text-secondary)] text-caption'>
          <TriangleAlert className='mt-[1px] size-[14px] shrink-0' />
          <span>
            Resources copied in during past syncs may remain afterwards. Undo restores workflows to
            their prior versions but does not remove copied resources.
          </span>
        </div>
      </ChipConfirmModal>

      <BulkActionDialog {...bulk.dialogProps} />
    </>
  )
}
