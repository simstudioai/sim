'use client'

import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'
import { ArrowUpDown, ListFilter, Plus, Search } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'

export interface PreviewColumn {
  id: string
  header: string
  width?: number
}

export interface PreviewCell {
  icon?: ReactNode
  label?: string
  content?: ReactNode
}

export interface PreviewRow {
  id: string
  cells: Record<string, PreviewCell>
}

interface LandingPreviewResourceProps {
  icon: React.ComponentType<{ className?: string }>
  title: string
  createLabel: string
  searchPlaceholder: string
  columns: PreviewColumn[]
  rows: PreviewRow[]
  onRowClick?: (id: string) => void
}

export function ownerCell(initial: string, name: string): PreviewCell {
  return {
    icon: (
      <span className='flex h-[14px] w-[14px] flex-shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-3)] font-medium text-[8px] text-[var(--text-secondary)]'>
        {initial}
      </span>
    ),
    label: name,
  }
}

export function LandingPreviewResource({
  icon: Icon,
  title,
  createLabel,
  searchPlaceholder,
  columns,
  rows,
  onRowClick,
}: LandingPreviewResourceProps) {
  const [search, setSearch] = useState('')
  const [sortColId, setSortColId] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  function handleSortClick(colId: string) {
    if (sortColId === colId) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortColId(colId)
      setSortDir('asc')
    }
  }

  const sorted = useMemo(() => {
    const q = search.toLowerCase()
    const filtered = q
      ? rows.filter((row) =>
          Object.values(row.cells).some((cell) => cell.label?.toLowerCase().includes(q))
        )
      : rows

    if (!sortColId) return filtered
    return [...filtered].sort((a, b) => {
      const av = a.cells[sortColId]?.label ?? ''
      const bv = b.cells[sortColId]?.label ?? ''
      const cmp = av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' })
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [rows, search, sortColId, sortDir])

  return (
    <div className='flex h-full flex-1 flex-col overflow-hidden bg-[var(--bg)]'>
      {/* Header */}
      <div className='border-[var(--border)] border-b px-6 py-2.5'>
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-3'>
            <Icon className='h-[14px] w-[14px] text-[var(--text-icon)]' />
            <h1 className='font-medium text-[var(--text-body)] text-sm'>{title}</h1>
          </div>
          <div className='flex cursor-default items-center rounded-md px-2 py-1 text-[var(--text-secondary)] text-caption'>
            <Plus className='mr-1.5 h-[14px] w-[14px] text-[var(--text-icon)]' />
            {createLabel}
          </div>
        </div>
      </div>

      {/* Options bar */}
      <div className='border-[var(--border)] border-b px-6 py-2.5'>
        <div className='flex items-center justify-between'>
          <div className='flex flex-1 items-center gap-2.5'>
            <Search className='h-[14px] w-[14px] flex-shrink-0 text-[var(--text-icon)]' />
            <input
              type='text'
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={searchPlaceholder}
              className='flex-1 bg-transparent text-[var(--text-body)] text-caption outline-none placeholder:text-[var(--text-subtle)]'
            />
          </div>
          <div className='flex items-center gap-1.5'>
            <div className='flex cursor-default items-center rounded-md px-2 py-1 text-[var(--text-secondary)] text-caption'>
              <ListFilter className='mr-1.5 h-[14px] w-[14px] text-[var(--text-icon)]' />
              Filter
            </div>
            <button
              type='button'
              onClick={() => handleSortClick(sortColId ?? columns[0]?.id)}
              className='flex cursor-default items-center rounded-md px-2 py-1 text-[var(--text-secondary)] text-caption transition-colors hover-hover:bg-[var(--surface-3)]'
            >
              <ArrowUpDown className='mr-1.5 h-[14px] w-[14px] text-[var(--text-icon)]' />
              Sort
            </button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className='min-h-0 flex-1 overflow-hidden'>
        <table className='w-full table-fixed text-sm'>
          <colgroup>
            {columns.map((col, i) => (
              <col
                key={col.id}
                style={i === 0 ? { minWidth: col.width ?? 200 } : { width: col.width ?? 160 }}
              />
            ))}
          </colgroup>
          <thead className='shadow-[inset_0_-1px_0_var(--border)]'>
            <tr>
              {columns.map((col) => (
                <th
                  key={col.id}
                  className='h-10 px-6 py-1.5 text-left align-middle font-normal text-caption'
                >
                  <button
                    type='button'
                    onClick={() => handleSortClick(col.id)}
                    className={cn(
                      'flex items-center gap-1 transition-colors hover-hover:text-[var(--text-secondary)]',
                      sortColId === col.id
                        ? 'text-[var(--text-secondary)]'
                        : 'text-[var(--text-muted)]'
                    )}
                  >
                    {col.header}
                    {sortColId === col.id && (
                      <ArrowUpDown className='h-[10px] w-[10px] opacity-60' />
                    )}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr
                key={row.id}
                onClick={() => onRowClick?.(row.id)}
                className={cn(
                  'transition-colors hover-hover:bg-[var(--surface-3)]',
                  onRowClick && 'cursor-pointer'
                )}
              >
                {columns.map((col, colIdx) => {
                  const cell = row.cells[col.id]
                  return (
                    <td key={col.id} className='px-6 py-2.5 align-middle'>
                      {cell?.content ? (
                        cell.content
                      ) : (
                        <span
                          className={cn(
                            'flex min-w-0 items-center gap-3 font-medium text-sm',
                            colIdx === 0
                              ? 'text-[var(--text-body)]'
                              : 'text-[var(--text-secondary)]'
                          )}
                        >
                          {cell?.icon && (
                            <span className='flex-shrink-0 text-[var(--text-icon)]'>
                              {cell.icon}
                            </span>
                          )}
                          <span className='truncate'>{cell?.label ?? '—'}</span>
                        </span>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
