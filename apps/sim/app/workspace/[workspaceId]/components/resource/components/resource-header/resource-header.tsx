import { Fragment } from 'react'
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

export interface DropdownOption {
  label: string
  icon?: React.ElementType
  onClick: () => void
  disabled?: boolean
}

export interface BreadcrumbItem {
  label: string
  onClick?: () => void
  dropdownItems?: DropdownOption[]
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

export function ResourceHeader({
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
        hasBreadcrumbs ? 'px-[16px] py-[8.5px]' : 'px-[24px] py-[10px]'
      )}
    >
      <div className='flex items-center justify-between'>
        <div className='flex items-center gap-[12px]'>
          {hasBreadcrumbs ? (
            breadcrumbs.map((crumb, i) => (
              <Fragment key={i}>
                {i > 0 && (
                  <span className='select-none text-[14px] text-[var(--text-icon)]'>/</span>
                )}
                <BreadcrumbSegment
                  icon={i === 0 ? Icon : undefined}
                  label={crumb.label}
                  onClick={crumb.onClick}
                  dropdownItems={crumb.dropdownItems}
                />
              </Fragment>
            ))
          ) : (
            <>
              {Icon && <Icon className='h-[14px] w-[14px] text-[var(--text-icon)]' />}
              {title && (
                <h1 className='font-medium text-[14px] text-[var(--text-body)]'>{title}</h1>
              )}
            </>
          )}
        </div>
        <div className='flex items-center gap-[6px]'>
          {actions?.map((action) => {
            const ActionIcon = action.icon
            return (
              <Button
                key={action.label}
                onClick={action.onClick}
                disabled={action.disabled}
                variant='subtle'
                className='px-[8px] py-[4px] text-[12px]'
              >
                {ActionIcon && (
                  <ActionIcon className={cn('h-[14px] w-[14px]', action.label && 'mr-[6px]')} />
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
              className='px-[8px] py-[4px] text-[12px]'
            >
              <Plus className='mr-[6px] h-[14px] w-[14px]' />
              {create.label}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

function BreadcrumbSegment({
  icon: Icon,
  label,
  onClick,
  dropdownItems,
}: {
  icon?: React.ElementType
  label: string
  onClick?: () => void
  dropdownItems?: DropdownOption[]
}) {
  const content = (
    <>
      {Icon && <Icon className='mr-[12px] h-[14px] w-[14px] text-[var(--text-icon)]' />}
      {label}
    </>
  )

  if (dropdownItems && dropdownItems.length > 0) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant='subtle' className='px-[8px] py-[4px] font-medium text-[14px]'>
            {content}
            <ChevronDown className='ml-[8px] h-[7px] w-[9px] shrink-0 text-[var(--text-muted)]' />
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
      <Button
        variant='subtle'
        className='px-[8px] py-[4px] font-medium text-[14px]'
        onClick={onClick}
      >
        {content}
      </Button>
    )
  }

  return (
    <span className='inline-flex items-center px-[8px] py-[4px] font-medium text-[14px] text-[var(--text-body)]'>
      {content}
    </span>
  )
}
