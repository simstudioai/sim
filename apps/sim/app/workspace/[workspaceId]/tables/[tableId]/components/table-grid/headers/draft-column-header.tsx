'use client'

import React, { useEffect, useRef } from 'react'
import { cn } from '@sim/emcn'
import type { ColumnDefinition } from '@/lib/table'
import { ColumnTypeIcon } from './column-type-icon'

interface DraftColumnHeaderProps {
  type: ColumnDefinition['type']
  name: string
  /** True after a refused commit — paints the name red until it's edited. */
  invalid: boolean
  onNameChange: (name: string) => void
  /** Enter or blur. The grid decides whether this persists the column. */
  onCommit: () => void
  /** Escape. Discards the draft — nothing was ever persisted. */
  onCancel: () => void
}

/**
 * Header cell for a column that exists only in this browser: the user picked
 * a type and is naming it, but nothing is persisted until the name commits
 * (or, for a type with configuration, until the sidebar saves). Renders like
 * the rename state of a real header so the draft reads as "the column, being
 * named" rather than a form. Like the "+ New column" cell it has no body
 * cells beneath it.
 */
export const DraftColumnHeader = React.memo(function DraftColumnHeader({
  type,
  name,
  invalid,
  onNameChange,
  onCommit,
  onCancel,
}: DraftColumnHeaderProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  return (
    <th className='relative border-[var(--border)] border-r border-b bg-[var(--bg)] p-0 text-left align-middle'>
      <div className='flex h-full w-full min-w-0 items-center px-2 py-[7px]'>
        <ColumnTypeIcon type={type} />
        <input
          ref={inputRef}
          type='text'
          value={name}
          aria-label='New column name'
          aria-invalid={invalid || undefined}
          onChange={(e) => onNameChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onCommit()
            if (e.key === 'Escape') onCancel()
          }}
          onBlur={onCommit}
          className={cn(
            'ml-1.5 min-w-0 flex-1 border-0 bg-transparent p-0 text-small outline-none focus:outline-none focus:ring-0',
            invalid ? 'text-[var(--text-error)]' : 'text-[var(--text-primary)]'
          )}
        />
      </div>
    </th>
  )
})
