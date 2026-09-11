'use client'

import React from 'react'
import { ChipButtonGroup, ChipButtonGroupItem, cn } from '@sim/emcn'
import type { PermissionType } from '@/lib/workspaces/permissions/utils'

export type { PermissionType }

type SelectorSize = 'default' | 'compact'

interface PermissionSelectorProps {
  value: PermissionType
  onChange: (value: PermissionType) => void
  disabled?: boolean
  className?: string
  size?: SelectorSize
}

export const PermissionSelector = React.memo<PermissionSelectorProps>(
  ({ value, onChange, disabled = false, className, size = 'default' }) => {
    const itemClass = size === 'compact' ? 'min-w-[38px]' : undefined
    return (
      <ChipButtonGroup
        size={size}
        value={value}
        onValueChange={(val) => onChange(val as PermissionType)}
        disabled={disabled}
        className={cn(disabled && 'cursor-not-allowed', className)}
      >
        <ChipButtonGroupItem value='read' className={itemClass} title='View only'>
          Read
        </ChipButtonGroupItem>
        <ChipButtonGroupItem value='write' className={itemClass} title='Edit content'>
          Write
        </ChipButtonGroupItem>
        <ChipButtonGroupItem value='admin' className={itemClass} title='Full access'>
          Admin
        </ChipButtonGroupItem>
      </ChipButtonGroup>
    )
  }
)
PermissionSelector.displayName = 'PermissionSelector'

export type OrgRole = 'admin' | 'member'

interface OrgRoleSelectorProps {
  value: OrgRole
  onChange: (value: OrgRole) => void
  disabled?: boolean
  className?: string
  size?: SelectorSize
}

export const OrgRoleSelector = React.memo<OrgRoleSelectorProps>(
  ({ value, onChange, disabled = false, className, size = 'compact' }) => {
    const itemClass = size === 'compact' ? 'min-w-[58px]' : undefined
    return (
      <ChipButtonGroup
        size={size}
        value={value}
        onValueChange={(val) => onChange(val as OrgRole)}
        disabled={disabled}
        className={cn(disabled && 'cursor-not-allowed', className)}
      >
        <ChipButtonGroupItem value='member' className={itemClass} title='Organization member'>
          Member
        </ChipButtonGroupItem>
        <ChipButtonGroupItem value='admin' className={itemClass} title='Organization admin'>
          Admin
        </ChipButtonGroupItem>
      </ChipButtonGroup>
    )
  }
)
OrgRoleSelector.displayName = 'OrgRoleSelector'
