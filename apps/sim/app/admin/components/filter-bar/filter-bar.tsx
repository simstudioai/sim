'use client'

import { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface FilterItem {
  id: string
  label: string
  icon?: ReactNode
  className?: string
}

interface FilterBarProps {
  currentFilter: string
  onFilterChange: (filter: string) => void
  filters: FilterItem[]
  variant?: 'default' | 'colored'
}

export function FilterBar({
  currentFilter,
  onFilterChange,
  filters,
  variant = 'default',
}: FilterBarProps) {
  return (
    <div className="flex items-center space-x-1 overflow-x-auto pb-1 flex-wrap gap-1.5">
      {filters.map((filter) => (
        <Button
          key={filter.id}
          variant={
            variant === 'default' ? (currentFilter === filter.id ? 'default' : 'ghost') : 'ghost'
          }
          onClick={() => onFilterChange(filter.id)}
          className={cn(
            'rounded-md px-3 text-sm font-medium transition-colors flex items-center gap-1.5 h-9',
            variant === 'default'
              ? currentFilter === filter.id
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
              : filter.className || ''
          )}
          size="sm"
        >
          {filter.icon && filter.icon}
          <span>{filter.label}</span>
        </Button>
      ))}
    </div>
  )
}
