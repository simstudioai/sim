'use client'

import type React from 'react'
import { memo } from 'react'
import { Button } from '@sim/emcn'
import { ChevronDown } from '@sim/emcn/icons'
import clsx from 'clsx'

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
      className='-m-1.5 p-1.5!'
      onClick={onClick}
      aria-label='Toggle terminal'
    >
      <ChevronDown
        className={clsx(
          'size-[14px] shrink-0 transition-transform duration-100',
          !isExpanded && 'rotate-180'
        )}
      />
    </Button>
  )
})
