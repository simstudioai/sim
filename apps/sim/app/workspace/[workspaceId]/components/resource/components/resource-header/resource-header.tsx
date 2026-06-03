import { Fragment, forwardRef, memo, useEffect, useRef, useState } from 'react'
import { ArrowUpLeft } from 'lucide-react'
import { createPortal } from 'react-dom'
import {
  Button,
  ChevronDown,
  chipVariants,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Plus,
  POPOVER_ANIMATION_CLASSES,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverItem,
  PopoverSection,
} from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { InlineRenameInput } from '@/app/workspace/[workspaceId]/components/inline-rename-input'
import { FloatingOverflowText } from '@/app/workspace/[workspaceId]/components/resource/components/floating-overflow-text'
import {
  FloatingTooltip,
  useFloatingTooltip,
  useIsOverflowing,
} from '@/app/workspace/[workspaceId]/components/resource/components/floating-tooltip'

const HEADER_PLUS_ICON = <Plus className='mr-1.5 size-[14px] text-[var(--text-icon)]' />

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
  icon?: React.ElementType
  onClick?: () => void
  dropdownItems?: DropdownOption[]
  editing?: BreadcrumbEditing
  /**
   * Marks a non-navigable trailing crumb (e.g. "New Chunk", "Loading...") so the
   * header sizes it as the terminal segment rather than the current resource.
   */
  terminal?: boolean
}

export interface HeaderAction {
  label: string
  icon?: React.ElementType
  onClick: () => void
  disabled?: boolean
  active?: boolean
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
  /** Arbitrary content rendered in the right-aligned actions row, before `actions`. */
  leadingActions?: React.ReactNode
  /** Arbitrary content rendered in the right-aligned actions row, before the Create button. */
  trailingActions?: React.ReactNode
  /**
   * Replaces the default Create button entirely — supply your own trigger (for
   * example a dropdown) when the create action needs richer UI. When provided,
   * `create` is ignored.
   */
  createTrigger?: React.ReactNode
}

export const ResourceHeader = memo(function ResourceHeader({
  icon: Icon,
  title,
  breadcrumbs,
  create,
  actions,
  leadingActions,
  trailingActions,
  createTrigger,
}: ResourceHeaderProps) {
  const headerRef = useRef<HTMLDivElement>(null)
  const hasBreadcrumbs = breadcrumbs && breadcrumbs.length > 0
  const terminalBreadcrumbIndex =
    hasBreadcrumbs && breadcrumbs[breadcrumbs.length - 1].terminal ? breadcrumbs.length - 1 : -1
  const currentResourceIndex =
    terminalBreadcrumbIndex > -1
      ? terminalBreadcrumbIndex - 1
      : hasBreadcrumbs && breadcrumbs.length > 2
        ? breadcrumbs.length - 1
        : -1

  return (
    <div
      ref={headerRef}
      className={cn(
        'border-[var(--border)] border-b',
        hasBreadcrumbs ? 'px-4 py-[8.5px]' : 'px-6 py-2.5'
      )}
    >
      <div className='flex min-w-0 items-center justify-between gap-3'>
        <div className='flex min-w-0 flex-1 items-center gap-2 overflow-hidden'>
          {hasBreadcrumbs ? (
            breadcrumbs.map((crumb, i) => {
              const segmentClassName = getBreadcrumbSegmentClassName(
                i,
                breadcrumbs.length,
                currentResourceIndex,
                terminalBreadcrumbIndex
              )
              const LocationIcon = i === 0 ? (crumb.icon ?? Icon) : undefined

              return (
                <Fragment key={`${crumb.label}-${i}`}>
                  {i > 0 && (
                    <span className='mx-0.5 shrink-0 select-none text-[var(--text-icon)] text-sm'>
                      /
                    </span>
                  )}
                  {LocationIcon ? (
                    <BreadcrumbLocationPopover
                      icon={LocationIcon}
                      breadcrumbs={breadcrumbs}
                      className={segmentClassName}
                      veilBoundaryRef={headerRef}
                    />
                  ) : (
                    <BreadcrumbSegment
                      icon={crumb.icon}
                      label={crumb.label}
                      onClick={crumb.onClick}
                      dropdownItems={crumb.dropdownItems}
                      editing={crumb.editing}
                      className={segmentClassName}
                    />
                  )}
                </Fragment>
              )
            })
          ) : (
            <>
              {Icon && <Icon className='size-[14px] shrink-0 text-[var(--text-icon)]' />}
              {title && (
                <h1 className='min-w-0 flex-1 font-medium text-[var(--text-body)] text-sm'>
                  <FloatingOverflowText label={title} className='block truncate' />
                </h1>
              )}
            </>
          )}
        </div>
        <div className='flex shrink-0 items-center gap-1.5'>
          {leadingActions}
          {actions?.map((action) => {
            const ActionIcon = action.icon
            return (
              <Button
                key={action.label}
                onClick={action.onClick}
                disabled={action.disabled}
                variant='subtle'
                className={cn(
                  'whitespace-nowrap px-2 py-1 text-caption',
                  action.active !== undefined && 'rounded-lg',
                  action.active === true &&
                    'bg-[var(--surface-active)] hover-hover:bg-[var(--surface-active)]',
                  action.active === false && 'hover-hover:bg-[var(--surface-hover)]'
                )}
              >
                {ActionIcon && (
                  <ActionIcon
                    className={cn('size-[14px] text-[var(--text-icon)]', action.label && 'mr-1.5')}
                  />
                )}
                {action.label}
              </Button>
            )
          })}
          {trailingActions}
          {createTrigger ??
            (create && (
              <Button
                onClick={create.onClick}
                disabled={create.disabled}
                variant='subtle'
                className='whitespace-nowrap px-2 py-1 text-caption'
              >
                {HEADER_PLUS_ICON}
                {create.label}
              </Button>
            ))}
        </div>
      </div>
    </div>
  )
})

function getBreadcrumbSegmentClassName(
  index: number,
  total: number,
  currentResourceIndex: number,
  terminalBreadcrumbIndex: number
): string {
  if (index === terminalBreadcrumbIndex) {
    return 'shrink-0 max-w-[10rem]'
  }

  if (index === 0) {
    return 'shrink-0'
  }

  if (currentResourceIndex > -1) {
    if (index === currentResourceIndex) {
      return 'min-w-0 flex-[0_1_auto] max-w-[56%]'
    }

    return 'min-w-0 flex-[0_1_auto] max-w-[34%]'
  }

  if (total > 2) {
    return 'min-w-0 flex-[0_1_auto] max-w-[42%]'
  }

  return 'min-w-0 flex-[0_1_auto] max-w-[min(32rem,55vw)]'
}

interface BreadcrumbSegmentProps {
  icon?: React.ElementType
  label: string
  onClick?: () => void
  dropdownItems?: DropdownOption[]
  editing?: BreadcrumbEditing
  className?: string
}

const BreadcrumbSegment = memo(function BreadcrumbSegment({
  icon: Icon,
  label,
  onClick,
  dropdownItems,
  editing,
  className,
}: BreadcrumbSegmentProps) {
  const { ref: labelRef, node: labelNode, isOverflowing } = useIsOverflowing<HTMLSpanElement>()
  const { state: tooltipState, handlers: tooltipHandlers } = useFloatingTooltip((target) =>
    isBreadcrumbTextClipped(labelNode.current, target)
  )

  if (editing?.isEditing) {
    return (
      <span className={cn('inline-flex h-[30px] min-w-0 items-center px-2', className)}>
        {Icon && <Icon className='mr-3 size-[14px] text-[var(--text-icon)]' />}
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
      {Icon && <Icon className='size-[14px] shrink-0 text-[var(--text-icon)]' />}
      <BreadcrumbLabel ref={labelRef} isOverflowing={isOverflowing} label={label} />
    </>
  )
  const triggerClassName = cn(
    chipVariants({ variant: 'ghost', flush: true }),
    'group min-w-0 max-w-full justify-start font-medium transition-colors'
  )

  if (dropdownItems && dropdownItems.length > 0) {
    return (
      <>
        <DropdownMenu>
          <FloatingTooltip label={label} state={tooltipState} />
          <DropdownMenuTrigger asChild>
            <Button
              variant='subtle'
              className={cn(triggerClassName, className, 'border-0')}
              {...tooltipHandlers}
            >
              {content}
              <ChevronDown className='ml-auto h-[7px] w-[9px] shrink-0 text-[var(--text-muted)]' />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='start'>
            {dropdownItems.map((item) => {
              const ItemIcon = item.icon
              return (
                <DropdownMenuItem key={item.label} onClick={item.onClick} disabled={item.disabled}>
                  {ItemIcon && <ItemIcon className='size-[14px]' />}
                  {item.label}
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </>
    )
  }

  if (onClick) {
    return (
      <>
        <FloatingTooltip label={label} state={tooltipState} />
        <Button
          variant='subtle'
          className={cn(triggerClassName, className, 'border-0')}
          onClick={onClick}
          {...tooltipHandlers}
        >
          {content}
        </Button>
      </>
    )
  }

  return (
    <>
      <FloatingTooltip label={label} state={tooltipState} />
      <span
        className={cn(
          chipVariants({ variant: 'ghost', flush: true }),
          'group min-w-0 max-w-full cursor-default justify-start font-medium',
          className
        )}
        {...tooltipHandlers}
      >
        {content}
      </span>
    </>
  )
})

interface BreadcrumbLocationPopoverProps {
  icon: React.ElementType
  breadcrumbs: BreadcrumbItem[]
  className?: string
  veilBoundaryRef: React.RefObject<HTMLDivElement | null>
}

function BreadcrumbLocationPopover({
  icon: Icon,
  breadcrumbs,
  className,
  veilBoundaryRef,
}: BreadcrumbLocationPopoverProps) {
  const [open, setOpen] = useState(false)
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rootBreadcrumb = breadcrumbs[0]

  const openPopover = () => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current)
      closeTimeoutRef.current = null
    }
    setOpen(true)
  }

  const scheduleClose = () => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current)
    }
    closeTimeoutRef.current = setTimeout(() => {
      setOpen(false)
      closeTimeoutRef.current = null
    }, 120)
  }

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current)
    }
  }, [])

  return (
    <>
      <LocationFocusVeil visible={open} boundaryRef={veilBoundaryRef} />
      <Popover size='md' open={open} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <button
            type='button'
            aria-label={rootBreadcrumb?.label ?? 'Path'}
            onClick={rootBreadcrumb?.onClick}
            onFocus={openPopover}
            onBlur={scheduleClose}
            onMouseEnter={openPopover}
            onMouseLeave={scheduleClose}
            onMouseMove={openPopover}
            onPointerEnter={openPopover}
            onPointerLeave={scheduleClose}
            onPointerMove={openPopover}
            className={cn(
              chipVariants({ variant: 'ghost', flush: true }),
              'max-w-none gap-1.5 px-2 font-medium transition-colors',
              open && 'relative z-[var(--z-popover)]',
              className
            )}
          >
            <span className='relative inline-grid size-[14px] shrink-0 place-items-center'>
              <Icon className='col-start-1 row-start-1 size-[14px] text-[var(--text-icon)] opacity-100 blur-0 transition-[opacity,filter,transform] duration-200 ease-in-out group-hover:scale-[0.25] group-hover:opacity-0 group-hover:blur-[2px] group-focus-visible:scale-[0.25] group-focus-visible:opacity-0 group-focus-visible:blur-[2px] motion-reduce:transition-none' />
              <ArrowUpLeft
                strokeWidth={1.55}
                className='col-start-1 row-start-1 size-[14px] scale-[0.25] text-[var(--text-icon)] opacity-0 blur-[2px] transition-[opacity,filter,transform] duration-200 ease-in-out group-hover:scale-100 group-hover:opacity-100 group-hover:blur-0 group-focus-visible:scale-100 group-focus-visible:opacity-100 group-focus-visible:blur-0 motion-reduce:transition-none'
              />
            </span>
            {rootBreadcrumb?.label && (
              <span className='shrink-0 truncate text-[var(--text-body)] text-sm'>
                {rootBreadcrumb.label}
              </span>
            )}
          </button>
        </PopoverAnchor>
        <PopoverContent
          side='bottom'
          align='start'
          sideOffset={6}
          minWidth={220}
          maxWidth={300}
          maxHeight={420}
          border
          className={cn(
            POPOVER_ANIMATION_CLASSES,
            'bg-[var(--bg)] p-1.5 text-[var(--text-body)] shadow-sm'
          )}
          onMouseEnter={openPopover}
          onMouseLeave={scheduleClose}
          onMouseMove={openPopover}
          onPointerEnter={openPopover}
          onPointerLeave={scheduleClose}
          onPointerMove={openPopover}
        >
          <PopoverSection className='px-1.5 py-0.5 text-[var(--text-muted)] text-xs'>
            <span className='inline-flex items-center gap-1'>
              <span>Path</span>
              <span className='opacity-70'>/</span>
            </span>
          </PopoverSection>
          <div className='flex flex-col gap-0.5'>
            {breadcrumbs.map((crumb, index) => (
              <BreadcrumbLocationItem
                key={`${crumb.label}-${index}`}
                icon={crumb.icon || (index === 0 ? Icon : undefined)}
                label={crumb.label}
                onClick={crumb.onClick}
                active={index === breadcrumbs.length - 1}
              />
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </>
  )
}

function LocationFocusVeil({
  visible,
  boundaryRef,
}: {
  visible: boolean
  boundaryRef: React.RefObject<HTMLDivElement | null>
}) {
  const [bounds, setBounds] = useState({ top: 0, left: 0 })

  useEffect(() => {
    if (!visible) return

    const updateBounds = () => {
      const boundary = boundaryRef.current
      if (!boundary) return

      const rect = boundary.getBoundingClientRect()
      setBounds({ top: rect.top, left: rect.left })
    }

    updateBounds()
    window.addEventListener('resize', updateBounds)
    window.addEventListener('scroll', updateBounds, true)

    return () => {
      window.removeEventListener('resize', updateBounds)
      window.removeEventListener('scroll', updateBounds, true)
    }
  }, [boundaryRef, visible])

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      aria-hidden='true'
      className={cn(
        'pointer-events-none fixed right-0 bottom-0 z-[calc(var(--z-popover)-1)] bg-[var(--bg)] transition-opacity duration-150 ease-out motion-reduce:transition-none',
        visible ? 'opacity-60' : 'opacity-0'
      )}
      style={{ top: bounds.top, left: bounds.left }}
    />,
    document.body
  )
}

interface BreadcrumbLocationItemProps {
  icon?: React.ElementType
  label: string
  onClick?: () => void
  active: boolean
}

function BreadcrumbLocationItem({
  icon: Icon,
  label,
  onClick,
  active,
}: BreadcrumbLocationItemProps) {
  const labelContent = (
    <>
      <span className='flex size-[18px] shrink-0 items-center justify-center'>
        {Icon ? (
          <Icon className='size-3 text-[var(--text-icon)]' />
        ) : (
          <span className='size-1.5 rounded-full bg-[var(--text-muted)]' />
        )}
      </span>
      <span className='min-w-0 flex-1 truncate text-left'>{label}</span>
    </>
  )

  if (onClick) {
    return (
      <PopoverItem
        active={active}
        onClick={onClick}
        className='h-7 items-center gap-1.5 px-1.5 py-0 text-xs'
      >
        {labelContent}
      </PopoverItem>
    )
  }

  return (
    <div
      className={cn(
        'flex h-7 min-w-0 items-center gap-1.5 rounded-lg px-1.5 text-[var(--text-body)] text-xs',
        active && 'bg-[var(--surface-active)]'
      )}
    >
      {labelContent}
    </div>
  )
}

const BreadcrumbLabel = memo(
  forwardRef<HTMLSpanElement, BreadcrumbLabelProps>(function BreadcrumbLabel(
    { isOverflowing, label },
    ref
  ) {
    return (
      <span
        ref={ref}
        className={cn(
          'min-w-0 truncate',
          isOverflowing &&
            '[mask-image:linear-gradient(to_right,black_calc(100%-18px),transparent)] group-hover:[mask-image:none] group-focus-visible:[mask-image:none]'
        )}
      >
        {label}
      </span>
    )
  })
)

interface BreadcrumbLabelProps {
  isOverflowing: boolean
  label: string
}

function isBreadcrumbTextClipped(
  labelElement: HTMLSpanElement | null,
  triggerElement: HTMLElement
): boolean {
  if (!labelElement) return false

  const labelWidth = labelElement.getBoundingClientRect().width
  const triggerWidth = triggerElement.getBoundingClientRect().width
  const visibleLabelWidth = Math.min(labelWidth, triggerWidth)

  return (
    labelElement.scrollWidth > labelElement.clientWidth + 1 ||
    triggerElement.scrollWidth > triggerElement.clientWidth + 1 ||
    labelElement.scrollWidth > visibleLabelWidth + 1
  )
}
