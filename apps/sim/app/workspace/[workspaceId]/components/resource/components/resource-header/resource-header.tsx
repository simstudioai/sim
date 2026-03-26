import { Fragment, memo } from 'react'
import {
  Button,
  ChevronDown,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Plus,
} from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { InlineRenameInput } from '@/app/workspace/[workspaceId]/components/inline-rename-input'

export interface DropdownOption {
  label: string
  icon?: React.ElementType
  onClick: () => void
  disabled?: boolean
}

export interface BreadcrumbEditing {
  isEditing: boolean
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  onCancel: () => void
}

export interface BreadcrumbItem {
  label: string
  onClick?: () => void
  dropdownItems?: DropdownOption[]
  editing?: BreadcrumbEditing
}

export interface HeaderAction {
  label: string
  icon?: React.ElementType
  onClick: () => void
  disabled?: boolean
}

export interface CreateAction {
  label: string
  onClick: () => void
  disabled?: boolean
}

interface ResourceHeaderProps {
  icon?: React.ElementType
  title?: string
  breadcrumbs?: BreadcrumbItem[]
  create?: CreateAction
  actions?: HeaderAction[]
}

export const ResourceHeader = memo(function ResourceHeader({
  icon: Icon,
  title,
  breadcrumbs,
  create,
  actions,
}: ResourceHeaderProps) {
  const hasBreadcrumbs = breadcrumbs && breadcrumbs.length > 0

  return (
    <div
      className={cn(
        'border-[var(--border)] border-b',
        hasBreadcrumbs ? 'px-4 py-[8.5px]' : 'px-6 py-2.5'
      )}
    >
      <div className='flex items-center justify-between'>
        <div className='flex items-center gap-3'>
          {hasBreadcrumbs ? (
            breadcrumbs.map((crumb, i) => (
              <Fragment key={i}>
                {i > 0 && <span className='select-none text-[var(--text-icon)] text-sm'>/</span>}
                <BreadcrumbSegment
                  icon={i === 0 ? Icon : undefined}
                  label={crumb.label}
                  onClick={crumb.onClick}
                  dropdownItems={crumb.dropdownItems}
                  editing={crumb.editing}
                />
              </Fragment>
            ))
          ) : (
            <>
              {Icon && <Icon className='h-[14px] w-[14px] text-[var(--text-icon)]' />}
              {title && <h1 className='font-medium text-[var(--text-body)] text-sm'>{title}</h1>}
            </>
          )}
        </div>
        <div className='flex items-center gap-1.5'>
          {actions?.map((action) => {
            const ActionIcon = action.icon
            return (
              <Button
                key={action.label}
                onClick={action.onClick}
                disabled={action.disabled}
                variant='subtle'
                className='px-2 py-1 text-caption'
              >
                {ActionIcon && (
                  <ActionIcon
                    className={cn(
                      'h-[14px] w-[14px] text-[var(--text-icon)]',
                      action.label && 'mr-1.5'
                    )}
                  />
                )}
                {action.label}
              </Button>
            )
          })}
          {create && (
            <Button
              onClick={create.onClick}
              disabled={create.disabled}
              variant='subtle'
              className='px-2 py-1 text-caption'
            >
              <Plus className='mr-1.5 h-[14px] w-[14px] text-[var(--text-icon)]' />
              {create.label}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
})

function BreadcrumbSegment({
  icon: Icon,
  label,
  onClick,
  dropdownItems,
  editing,
}: {
  icon?: React.ElementType
  label: string
  onClick?: () => void
  dropdownItems?: DropdownOption[]
  editing?: BreadcrumbEditing
}) {
  if (editing?.isEditing) {
    return (
      <span className='inline-flex items-center px-2 py-1'>
        {Icon && <Icon className='mr-3 h-[14px] w-[14px] text-[var(--text-icon)]' />}
        <InlineRenameInput
          value={editing.value}
          onChange={editing.onChange}
          onSubmit={editing.onSubmit}
          onCancel={editing.onCancel}
        />
      </span>
    )
  }

  const content = (
    <>
      {Icon && <Icon className='mr-3 h-[14px] w-[14px] text-[var(--text-icon)]' />}
      {label}
    </>
  )

  if (dropdownItems && dropdownItems.length > 0) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant='subtle' className='px-2 py-1 font-medium text-sm'>
            {content}
            <ChevronDown className='ml-2 h-[7px] w-[9px] shrink-0 text-[var(--text-muted)]' />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='start'>
          {dropdownItems.map((item) => {
            const ItemIcon = item.icon
            return (
              <DropdownMenuItem key={item.label} onClick={item.onClick} disabled={item.disabled}>
                {ItemIcon && <ItemIcon className='h-[14px] w-[14px]' />}
                {item.label}
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  if (onClick) {
    return (
      <Button variant='subtle' className='px-2 py-1 font-medium text-sm' onClick={onClick}>
        {content}
      </Button>
    )
  }

  return (
    <span className='inline-flex items-center px-2 py-1 font-medium text-[var(--text-body)] text-sm'>
      {content}
    </span>
  )
}
