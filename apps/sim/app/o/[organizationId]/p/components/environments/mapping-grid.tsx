'use client'

import type { ReactNode } from 'react'
import { Badge, ChipCombobox, OverflowText, Skeleton, toast } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import type { WorkspaceCredential } from '@/lib/api/contracts/credentials'
import { resolveCredentialDisplay } from '@/lib/integrations/credential-display'
import {
  type EnvironmentColumn,
  isCopyableKind,
  leafResourceId,
  MAPPING_STATUS,
  type MappingCell,
  type MappingRow,
  type MappingStatus,
  type WorkflowCell,
  type WorkflowRow,
} from '@/app/o/[organizationId]/p/components/environments/mapping-model'
import { IntegrationTile } from '@/app/workspace/[workspaceId]/integrations/components/integrations-showcase'
import { useUpdateForkMapping } from '@/ee/workspace-forking/hooks/workspace-fork'

/** Option that clears the target so a sync copies the resource instead; handled via onSelect, never sent. */
const NEW_COPY_VALUE = '__new_copy__'

const SKELETON_ROW_COUNT = 3

interface StatusBadgeProps {
  status: MappingStatus
}

/** One cell's mapping status in the sync view's vocabulary and colors. */
export function StatusBadge({ status }: StatusBadgeProps) {
  const { label, variant } = MAPPING_STATUS[status]
  return (
    <Badge variant={variant} size='sm' dot>
      {label}
    </Badge>
  )
}

interface EnvironmentTableProps {
  columns: readonly EnvironmentColumn[]
  children: ReactNode
}

/** The grid frame: a resource column, then one column per environment. */
export function EnvironmentTable({ columns, children }: EnvironmentTableProps) {
  return (
    <div className='overflow-x-auto rounded-lg border border-[var(--border)]'>
      <table className='w-full min-w-[640px] table-fixed border-collapse text-small'>
        <colgroup>
          <col className='w-[240px]' />
          {columns.map((column) => (
            <col key={column.id} />
          ))}
        </colgroup>
        <thead>
          <tr className='border-[var(--border)] border-b'>
            <th scope='col' className='h-9 px-3 text-left font-normal text-[var(--text-muted)]'>
              Resource
            </th>
            {columns.map((column) => (
              <th key={column.id} scope='col' className='h-9 px-3 text-left font-normal'>
                <div className='flex items-baseline gap-2'>
                  <span className='shrink-0 text-[var(--text-body)]'>{column.label}</span>
                  <OverflowText label={column.name} className='text-[var(--text-muted)]' />
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

interface EmptyRowProps {
  columns: readonly EnvironmentColumn[]
  children: ReactNode
}

function EmptyRow({ columns, children }: EmptyRowProps) {
  return (
    <tr>
      <td colSpan={columns.length + 1} className='px-3 py-6 text-center text-[var(--text-muted)]'>
        {children}
      </td>
    </tr>
  )
}

interface SkeletonRowsProps {
  columns: readonly EnvironmentColumn[]
}

/** Placeholder rows while the edges' mappings load. */
export function SkeletonRows({ columns }: SkeletonRowsProps) {
  return Array.from({ length: SKELETON_ROW_COUNT }, (_, index) => (
    <tr key={index} className='border-[var(--border)] border-b last:border-b-0'>
      <td className='px-3 py-3'>
        <Skeleton className='h-[14px] w-[160px]' />
      </td>
      {columns.map((column) => (
        <td key={column.id} className='px-3 py-3'>
          <Skeleton className='h-[14px] w-[120px]' />
        </td>
      ))}
    </tr>
  ))
}

function AbsentCell() {
  return <span className='text-[var(--text-muted)]'>—</span>
}

interface MappingCellViewProps {
  cell: MappingCell
  /** The viewer may change this edge's target; the cell renders the candidate picker. */
  editable: boolean
  /** This cell's edit is in flight. */
  pending: boolean
  onChange: (targetId: string | null) => void
}

/** A resource on one environment's side: its name (or the target picker) and its status. */
function MappingCellView({ cell, editable, pending, onChange }: MappingCellViewProps) {
  const entry = cell.entry
  if (!editable || !entry) {
    return (
      <div className='flex flex-col gap-1.5'>
        <OverflowText label={cell.label || '—'} className='text-[var(--text-body)]' />
        {cell.status ? <StatusBadge status={cell.status} /> : null}
      </div>
    )
  }
  const copyable = isCopyableKind(entry.kind) && !entry.sourceDeleted
  const targetListed = entry.candidates.some((candidate) => candidate.id === entry.targetId)
  const options = [
    // A stored target past the capped candidate list still shows its name when closed.
    ...(entry.targetId && !targetListed
      ? [{ label: cell.label, value: entry.targetId, hidden: true }]
      : []),
    // The way back to the copy flow after mapping: clears the target via onSelect.
    ...(copyable && entry.targetId
      ? [{ label: 'New copy', value: NEW_COPY_VALUE, onSelect: () => onChange(null) }]
      : []),
    ...entry.candidates.map((candidate) => ({ label: candidate.label, value: candidate.id })),
  ]
  return (
    <div className='flex flex-col gap-1.5'>
      <ChipCombobox
        className='w-full'
        align='start'
        options={options}
        value={entry.targetId ?? undefined}
        onChange={(value) => onChange(value)}
        placeholder={copyable ? 'Copy on sync' : 'Select target'}
        searchable
        searchPlaceholder='Search targets'
        disabled={pending}
      />
      {cell.status ? <StatusBadge status={cell.status} /> : null}
    </div>
  )
}

interface MappingGridProps {
  columns: readonly EnvironmentColumn[]
  rows: readonly MappingRow[]
  /** Admin with forking available: child cells become candidate pickers. */
  canEdit: boolean
  empty: string
  /** Credentials by environment id, for the provider mark on credential rows. */
  credentialsByEnv?: ReadonlyMap<string, ReadonlyMap<string, WorkspaceCredential>>
}

interface ResourceLabelProps {
  row: MappingRow
  columns: readonly EnvironmentColumn[]
  credentialsByEnv?: ReadonlyMap<string, ReadonlyMap<string, WorkspaceCredential>>
}

/** The resource's name, led by its provider's mark for a credential the lineage still holds. */
function ResourceLabel({ row, columns, credentialsByEnv }: ResourceLabelProps) {
  const leaf = row.kind === 'credential' ? leafResourceId(row, columns) : null
  const credential = leaf ? credentialsByEnv?.get(leaf.environmentId)?.get(leaf.id) : undefined
  const display = credential ? resolveCredentialDisplay(credential) : null
  return (
    <div className='flex min-w-0 items-center gap-2'>
      {display?.icon ? <IntegrationTile blockType={display.blockType} icon={display.icon} /> : null}
      <OverflowText label={row.label} className='text-[var(--text-body)]' />
    </div>
  )
}

/**
 * One row per resource, one cell per environment. A child cell's picker saves through the
 * edge's mapping route at once, so the forks settings page of that fork shows the same target.
 */
export function MappingGrid({ columns, rows, canEdit, credentialsByEnv, empty }: MappingGridProps) {
  const updateMapping = useUpdateForkMapping()
  const pendingKey =
    updateMapping.isPending && updateMapping.variables
      ? `${updateMapping.variables.workspaceId}:${updateMapping.variables.body.entries[0]?.sourceId ?? ''}`
      : null

  const saveTarget = (cell: MappingCell, targetId: string | null) => {
    if (!cell.entry || !cell.edge) return
    updateMapping.mutate(
      {
        workspaceId: cell.edge.childId,
        body: {
          otherWorkspaceId: cell.edge.parentId,
          direction: 'pull',
          entries: [
            { resourceType: cell.entry.resourceType, sourceId: cell.entry.sourceId, targetId },
          ],
        },
      },
      {
        onSuccess: () => toast.success('Mapping saved'),
        onError: (error) => toast.error(getErrorMessage(error, 'Failed to save mapping')),
      }
    )
  }

  return (
    <EnvironmentTable columns={columns}>
      {rows.length === 0 ? (
        <EmptyRow columns={columns}>{empty}</EmptyRow>
      ) : (
        rows.map((row) => (
          <tr key={row.key} className='border-[var(--border)] border-b align-top last:border-b-0'>
            <td className='px-3 py-2'>
              <ResourceLabel row={row} columns={columns} credentialsByEnv={credentialsByEnv} />
            </td>
            {columns.map((column) => {
              const cell = row.cells[column.id]
              return (
                <td key={column.id} className='px-3 py-2'>
                  {cell ? (
                    <MappingCellView
                      cell={cell}
                      editable={canEdit}
                      pending={pendingKey === `${cell.edge?.childId}:${cell.entry?.sourceId}`}
                      onChange={(targetId) => saveTarget(cell, targetId)}
                    />
                  ) : (
                    <AbsentCell />
                  )}
                </td>
              )
            })}
          </tr>
        ))
      )}
    </EnvironmentTable>
  )
}

interface WorkflowCellViewProps {
  cell: WorkflowCell
}

function WorkflowCellView({ cell }: WorkflowCellViewProps) {
  return (
    <div className='flex flex-col gap-1.5'>
      <OverflowText label={cell.name ?? '—'} className='text-[var(--text-body)]' />
      <div className='flex flex-wrap items-center gap-2'>
        {cell.status ? <StatusBadge status={cell.status} /> : null}
        {cell.deployed !== null ? (
          <span className='text-[var(--text-muted)] text-caption'>
            {cell.deployed ? 'Deployed' : 'Draft'}
          </span>
        ) : null}
      </div>
    </div>
  )
}

interface WorkflowGridProps {
  columns: readonly EnvironmentColumn[]
  rows: readonly WorkflowRow[]
  empty: string
}

/** One row per deployed workflow, with what a sync would do on each edge and each side's deployed state. */
export function WorkflowGrid({ columns, rows, empty }: WorkflowGridProps) {
  return (
    <EnvironmentTable columns={columns}>
      {rows.length === 0 ? (
        <EmptyRow columns={columns}>{empty}</EmptyRow>
      ) : (
        rows.map((row) => (
          <tr key={row.key} className='border-[var(--border)] border-b align-top last:border-b-0'>
            <td className='px-3 py-2'>
              <OverflowText label={row.label} className='text-[var(--text-body)]' />
            </td>
            {columns.map((column) => {
              const cell = row.cells[column.id]
              return (
                <td key={column.id} className='px-3 py-2'>
                  {cell ? <WorkflowCellView cell={cell} /> : <AbsentCell />}
                </td>
              )
            })}
          </tr>
        ))
      )}
    </EnvironmentTable>
  )
}
