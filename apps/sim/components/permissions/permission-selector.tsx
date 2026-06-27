'use client'

import React from 'react'
import { ButtonGroup, ButtonGroupItem } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import type { PermissionType } from '@/lib/workspaces/permissions/utils'
import { useTranslations } from 'next-intl'

export type { PermissionType }

type SelectorSize = 'default' | 'compact'

interface PermissionSelectorProps {
  value: PermissionType
  onChange: (value: PermissionType) => void
  disabled?: boolean
  className?: string
  size?: SelectorSize
}

const COMPACT_ITEM_CLASS = 'h-[22px] min-w-[38px] px-1.5 py-0 text-xs'

export const PermissionSelector = React.memo<PermissionSelectorProps>(
  ({ value, onChange, disabled = false, className, size = 'default' }) => {
  const t = useTranslations('auto')
    const itemClass = size === 'compact' ? COMPACT_ITEM_CLASS : undefined
    return (
      <ButtonGroup
        value={value}
        onValueChange={(val) => onChange(val as PermissionType)}
        disabled={disabled}
        className={cn(disabled && 'cursor-not-allowed', className)}
      >
        <ButtonGroupItem value='read' className={itemClass} title={t('view_only')}>
          {t('read')}
        </ButtonGroupItem>
        <ButtonGroupItem value='write' className={itemClass} title={t('edit_content')}>
          {t('write')}
        </ButtonGroupItem>
        <ButtonGroupItem value='admin' className={itemClass} title={t('full_access')}>
          {t('admin')}
        </ButtonGroupItem>
      </ButtonGroup>
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

const COMPACT_ORG_ITEM_CLASS = 'h-[22px] min-w-[58px] px-1.5 py-0 text-xs'

export const OrgRoleSelector = React.memo<OrgRoleSelectorProps>(
  ({ value, onChange, disabled = false, className, size = 'compact' }) => {
  const t = useTranslations('auto')
    const itemClass = size === 'compact' ? COMPACT_ORG_ITEM_CLASS : undefined
    return (
      <ButtonGroup
        value={value}
        onValueChange={(val) => onChange(val as OrgRole)}
        disabled={disabled}
        className={cn(disabled && 'cursor-not-allowed', className)}
      >
        <ButtonGroupItem value='member' className={itemClass} title={t('organization_member')}>
          {t('member')}
        </ButtonGroupItem>
        <ButtonGroupItem value='admin' className={itemClass} title={t('organization_admin')}>
          {t('admin')}
        </ButtonGroupItem>
      </ButtonGroup>
    )
  }
)
OrgRoleSelector.displayName = 'OrgRoleSelector'
