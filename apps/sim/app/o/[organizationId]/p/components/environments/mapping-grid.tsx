'use client'

import type { ReactNode } from 'react'
import { Badge, OverflowText, Skeleton } from '@sim/emcn'
import {
  type EnvironmentColumn,
  MAPPING_STATUS,
  type MappingStatus,
  type WorkflowCell,
  type WorkflowRow,
} from '@/app/o/[organizationId]/p/components/environments/mapping-model'

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
                  {column.name !== column.label ? (
                    <OverflowText label={column.name} className='text-[var(--text-muted)]' />
                  ) : null}
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
