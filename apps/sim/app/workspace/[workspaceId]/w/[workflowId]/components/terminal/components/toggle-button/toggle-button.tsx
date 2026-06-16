'use client'

import type React from 'react'
import { memo } from 'react'
import clsx from 'clsx'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/emcn'

export interface ToggleButtonProps {
  isExpanded: boolean
  onClick: (e: React.MouseEvent) => void
}

/**
 * Toggle button component for terminal expand/collapse
 */
export const ToggleButton = memo(function ToggleButton({ isExpanded, onClick }: ToggleButtonProps) {
  return (
    <Button
      variant='ghost'
      className='!p-1.5 -m-1.5'
      onClick={onClick}
      aria-label='Toggle terminal'
    >
      <ChevronDown
        className={clsx(
          'h-3.5 w-3.5 flex-shrink-0 transition-transform duration-100',
          !isExpanded && 'rotate-180'
        )}
      />
    </Button>
  )
})
