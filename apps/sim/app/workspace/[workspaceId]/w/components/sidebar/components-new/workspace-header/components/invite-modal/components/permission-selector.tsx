import React, { useMemo } from 'react'
import { Button } from '@/components/emcn'
import type { PermissionType } from '@/lib/permissions/utils'
import { cn } from '@/lib/utils'

export interface PermissionSelectorProps {
  value: PermissionType
  onChange: (value: PermissionType) => void
  disabled?: boolean
  className?: string
}

export const PermissionSelector = React.memo<PermissionSelectorProps>(
  ({ value, onChange, disabled = false, className = '' }) => {
    const permissionOptions = useMemo(
      () => [
        { value: 'read' as PermissionType, label: 'Read' },
        { value: 'write' as PermissionType, label: 'Write' },
        { value: 'admin' as PermissionType, label: 'Admin' },
      ],
      []
    )

    return (
      <div className={cn('inline-flex gap-[2px]', className)}>
        {permissionOptions.map((option, index) => {
          const radiusClasses =
            index === 0
              ? 'rounded-r-none'
              : index === permissionOptions.length - 1
                ? 'rounded-l-none'
                : 'rounded-none'

          return (
            <Button
              key={option.value}
              type='button'
              variant={value === option.value ? 'active' : 'default'}
              onClick={() => !disabled && onChange(option.value)}
              disabled={disabled}
              className={cn(
                'px-[8px] py-[4px] text-[12px]',
                radiusClasses,
                disabled && 'cursor-not-allowed'
              )}
            >
              {option.label}
            </Button>
          )
        })}
      </div>
    )
  }
)

PermissionSelector.displayName = 'PermissionSelector'
