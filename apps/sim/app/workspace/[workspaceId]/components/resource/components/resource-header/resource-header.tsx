import { Fragment } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'

export interface BreadcrumbItem {
  label: string
  onClick?: () => void
}

interface ResourceHeaderProps {
  icon?: React.ElementType
  title?: string
  breadcrumbs?: BreadcrumbItem[]
  create?: {
    label: string
    onClick: () => void
    disabled?: boolean
  }
}

export function ResourceHeader({ icon: Icon, title, breadcrumbs, create }: ResourceHeaderProps) {
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
  )
}

function BreadcrumbSegment({
  icon: Icon,
  label,
  onClick,
}: {
  icon?: React.ElementType
  label: string
  onClick?: () => void
}) {
  const content = (
    <>
      {Icon && <Icon className='mr-[12px] h-[14px] w-[14px] text-[var(--text-icon)]' />}
      {label}
    </>
  )

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
