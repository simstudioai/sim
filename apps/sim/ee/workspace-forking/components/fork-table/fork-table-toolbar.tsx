'use client'

import type { ReactNode } from 'react'
import { ChipInput } from '@sim/emcn'
import { Search } from '@sim/emcn/icons'

interface ForkTableToolbarProps {
  /**
   * The controlled search field. Omit it on a view that has nothing to search — a paginated feed,
   * where a box that only filtered the pages already loaded would quietly miss the rest.
   */
  search?: {
    value: string
    onChange: (value: string) => void
    placeholder: string
  }
  /**
   * Right-aligned controls — `ChipDropdown` / `Chip` elements. The toolbar renders them and never
   * interprets them: filtering and ordering stay with the caller.
   */
  filters?: ReactNode
}

/** The search-and-filter row above a {@link ForkTable}, drawn like the shared table's toolbar. */
export function ForkTableToolbar({ search, filters }: ForkTableToolbarProps) {
  return (
    <div className='flex items-center justify-end gap-2'>
      {search ? (
        <ChipInput
          icon={Search}
          className='min-w-0 flex-1'
          value={search.value}
          placeholder={search.placeholder}
          aria-label={search.placeholder}
          onChange={(event) => search.onChange(event.target.value)}
        />
      ) : null}
      {filters ? <div className='flex shrink-0 items-center gap-2'>{filters}</div> : null}
    </div>
  )
}
