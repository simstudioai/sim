'use client'

import { useMemo } from 'react'
import { Badge, ChipCombobox, TableIdentityCell } from '@sim/emcn'
import type { ForkMatrixRow, ForkMatrixWorkspace } from '@/lib/api/contracts/workspace-fork'
import { forkKindLabel } from '@/ee/workspace-forking/components/fork-kind-label'
import type { ForkMatrixEditor } from '@/ee/workspace-forking/components/fork-mappings/use-fork-matrix-editor'
import { ForkTable, type ForkTableColumn } from '@/ee/workspace-forking/components/fork-table'
import type { ForkResourceFilter } from '@/ee/workspace-forking/search-params'

/** Wide enough for a full-length secret key, the longest label these cells hold. */
const WORKSPACE_COLUMN_WIDTH = 240
const RESOURCE_COLUMN_WIDTH = 280
const KIND_COLUMN_WIDTH = 130

interface MatrixCellProps {
  editor: ForkMatrixEditor
  row: ForkMatrixRow
  workspace: ForkMatrixWorkspace
}

/**
 * One workspace's value for one resource chain.
 *
 * The origin column states what the chain IS and never offers a picker — it is the source every
 * other column maps from. Every downstream column is the child half of exactly one edge, so it
 * renders that edge's target picker whenever the viewer may edit it, and states why not when they
 * may not.
 */
function MatrixCell({ editor, row, workspace }: MatrixCellProps) {
  const cell = row.cells[workspace.id]

  if (workspace.id === row.originWorkspaceId) {
    return (
      <span className='flex min-w-0 items-center gap-2'>
        <span className='min-w-0 truncate'>{cell?.label ?? row.label}</span>
        {cell?.missing ? (
          <Badge variant='red' size='sm'>
            Deleted
          </Badge>
        ) : null}
      </span>
    )
  }

  if (!cell) return <span className='text-[var(--text-subtle)]'>Not in this lineage</span>

  if (!editor.isEditable(row, workspace.id)) {
    if (cell.resourceId === null) {
      return <span className='text-[var(--text-subtle)]'>Not mapped</span>
    }
    return (
      <span className='flex min-w-0 items-center gap-2'>
        <span className='min-w-0 truncate'>{cell.label}</span>
        {cell.missing ? (
          <Badge variant='red' size='sm'>
            Deleted
          </Badge>
        ) : null}
      </span>
    )
  }

  const value = editor.valueFor(row, workspace.id)
  const candidates = editor.candidatesFor(workspace.id, row.kind)
  const options = candidates.map((candidate) => ({ label: candidate.label, value: candidate.id }))
  // A stored target the candidate list does not carry — deleted, or past the candidate cap —
  // still has to render as the current selection, or the picker would silently show it as empty.
  if (value && !candidates.some((candidate) => candidate.id === value)) {
    options.unshift({ label: cell.label ?? value, value })
  }

  return (
    <ChipCombobox
      className='w-full'
      align='start'
      options={options}
      value={value || undefined}
      onChange={(next) => editor.setValue(row, workspace.id, next)}
      placeholder='Not mapped'
      searchable
      searchPlaceholder='Search targets'
      emptyMessage='Nothing to map to in this workspace'
    />
  )
}

interface ForkMappingsProps {
  editor: ForkMatrixEditor
  loading: boolean
  searchTerm: string
  resourceFilter: ForkResourceFilter
}

/**
 * Every resource followed across one lineage: a row per resource, a column per workspace.
 *
 * This is the view that makes a chain legible — which secret each stage uses, which credential
 * production is pointed at — and it edits in place, because the question and the fix are the same
 * gesture. The resource column pins while the workspace columns scroll, so a wide lineage never
 * loses the row it is describing.
 */
export function ForkMappings({ editor, loading, searchTerm, resourceFilter }: ForkMappingsProps) {
  const query = searchTerm.trim().toLowerCase()

  const rows = useMemo(
    () =>
      editor.rows.filter((row) => {
        if (resourceFilter !== 'all' && row.kind !== resourceFilter) return false
        if (!query) return true
        if (row.label.toLowerCase().includes(query)) return true
        return Object.values(row.cells).some((cell) => cell.label?.toLowerCase().includes(query))
      }),
    [editor.rows, resourceFilter, query]
  )

  const columns: ForkTableColumn<ForkMatrixRow>[] = [
    {
      key: 'resource',
      header: 'Resource',
      width: RESOURCE_COLUMN_WIDTH,
      sticky: true,
      cell: (row) => <span className='block min-w-0 truncate'>{row.label}</span>,
    },
    {
      key: 'kind',
      header: 'Type',
      width: KIND_COLUMN_WIDTH,
      cell: (row) => <span className='text-[var(--text-muted)]'>{forkKindLabel(row.kind)}</span>,
    },
    ...editor.workspaces.map<ForkTableColumn<ForkMatrixRow>>((workspace) => ({
      key: workspace.id,
      width: WORKSPACE_COLUMN_WIDTH,
      header: (
        <TableIdentityCell
          primary={workspace.name}
          imageSrc={workspace.logoUrl ?? undefined}
          color={workspace.color ?? undefined}
          subject='resource'
        />
      ),
      cell: (row) => <MatrixCell editor={editor} row={row} workspace={workspace} />,
    })),
  ]

  return (
    <div className='flex min-w-0 flex-col gap-2'>
      <ForkTable
        aria-label='Resource mappings across the lineage'
        rows={rows}
        getRowId={(row) => row.key}
        columns={columns}
        loading={loading}
        empty={
          query || resourceFilter !== 'all'
            ? 'No resources match these filters'
            : 'Nothing is mapped in this lineage yet. Mappings appear once a fork is created or a sync is configured.'
        }
      />
      {editor.truncatedWorkspaceNames.length > 0 ? (
        <p className='text-[var(--text-muted)] text-caption'>
          {editor.truncatedWorkspaceNames.join(', ')} has more mapping targets than the picker
          loads, so search covers only the ones shown.
        </p>
      ) : null}
    </div>
  )
}
