import React from 'react'
import { ButtonGroup, ButtonGroupItem } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import type { PermissionType } from '@/lib/workspaces/permissions/utils'

export interface PermissionSelectorProps {
  value: PermissionType
  onChange: (value: PermissionType) => void
  disabled?: boolean
  className?: string
}

export const PermissionSelector = React.memo<PermissionSelectorProps>(
  ({ value, onChange, disabled = false, className = '' }) => {
    return (
      <ButtonGroup
        value={value}
        onValueChange={(val) => onChange(val as PermissionType)}
        disabled={disabled}
        className={cn(className, disabled && 'cursor-not-allowed')}
      >
        <ButtonGroupItem value='read'>Read</ButtonGroupItem>
        <ButtonGroupItem value='write'>Write</ButtonGroupItem>
        <ButtonGroupItem value='admin'>Admin</ButtonGroupItem>
      </ButtonGroup>
    )
  }
)

PermissionSelector.displayName = 'PermissionSelector'
