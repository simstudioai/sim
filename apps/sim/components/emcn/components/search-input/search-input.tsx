'use client'

/**
 * Chip-family search input matching the integrations page pattern: a 30px
 * `rounded-lg` filled surface with a leading magnifying-glass icon. Use this
 * for list filtering across settings and showcase pages instead of composing
 * a bordered div + raw input at every callsite.
 *
 * @example
 * ```tsx
 * import { SearchInput } from '@/components/emcn'
 *
 * <SearchInput
 *   placeholder='Search API keys...'
 *   value={searchTerm}
 *   onChange={(e) => setSearchTerm(e.target.value)}
 * />
 * ```
 */
import * as React from 'react'
import { Search } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'

export interface SearchInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Class applied to the outer container, not the inner input. */
  className?: string
}

export const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(
  ({ className, disabled, ...props }, ref) => {
    return (
      <div
        className={cn(
          'flex h-[30px] w-full items-center gap-2 rounded-lg border border-[var(--border-1)] bg-[var(--surface-5)] px-2 dark:bg-[var(--surface-4)]',
          disabled && 'opacity-60',
          className
        )}
      >
        <Search className='size-[14px] flex-shrink-0 text-[var(--text-muted)]' />
        <input
          ref={ref}
          type='text'
          disabled={disabled}
          className='h-full w-full bg-transparent text-[var(--text-body)] text-sm outline-none placeholder:text-[var(--text-muted)] focus:outline-none disabled:cursor-not-allowed'
          {...props}
        />
      </div>
    )
  }
)
SearchInput.displayName = 'SearchInput'
