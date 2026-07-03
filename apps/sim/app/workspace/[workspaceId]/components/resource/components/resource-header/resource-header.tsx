import {
  type ComponentType,
  Fragment,
  forwardRef,
  memo,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react'
import {
  Chip,
  ChipChevronDown,
  chipContentIconClass,
  chipGeometryClass,
  chipVariants,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  FloatingTooltip,
  POPOVER_ANIMATION_CLASSES,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverItem,
  PopoverSection,
  useFloatingTooltip,
  useIsOverflowing,
} from '@sim/emcn'
import { ArrowUpLeft } from 'lucide-react'
import { createPortal } from 'react-dom'
import { InlineRenameInput } from '@/app/workspace/[workspaceId]/components/inline-rename-input'
import { FloatingOverflowText } from '@/app/workspace/[workspaceId]/components/resource/components/floating-overflow-text'

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
  /**
   * Disables the rename field while the save is in flight, mirroring
   * {@link ResourceCellEditing.disabled} on table cells. Threaded from
   * `useInlineRename`'s `isSaving`. Optional so existing consumers keep
   * working unchanged.
   */
  disabled?: boolean
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

/**
 * The single, strict contract for a top-right header action. Every action renders
 * as a {@link Chip} — consumers describe intent through these fields and nothing
 * else, so the action row looks identical on every page and cannot drift. Omit
 * `variant` for the default chip; use `primary`/`destructive` for emphasis. Express
 * a selected/toggle state with `active` (e.g. the Logs/Dashboard view toggle).
 */
export interface ResourceAction {
  icon?: ComponentType<{ className?: string }>
  text: string
  variant?: 'primary' | 'destructive'
  active?: boolean
  onSelect: () => void
  disabled?: boolean
}

interface ResourceHeaderProps {
  icon?: React.ElementType
  title?: string
  breadcrumbs?: BreadcrumbItem[]
  /** Strict top-right action chips. List pages use ONLY this. */
  actions?: ResourceAction[]
  /**
   * Supplementary right-aligned content rendered before `actions` — custom
   * widgets that cannot collapse into the strict {@link ResourceAction} chip
   * contract, e.g. the table editor's run/stop control, an import-progress
   * menu, or a create dropdown. Anything that fits the chip contract belongs
   * in `actions`; never stuff primary actions in here.
   */
  aside?: ReactNode
}

export const ResourceHeader = memo(function ResourceHeader({
  icon: Icon,
  title,
  breadcrumbs,
  actions,
  aside,
}: ResourceHeaderProps) {
  const headerRef = useRef<HTMLDivElement>(null)
  /**
   * Breadcrumb mode is reserved for nested pages (length > 1). A single-crumb
   * "breadcrumb" is just the current page, so it falls through to the static
   * title below — keeping the top-left non-interactive and hover-free,
   * identical to a title-only page (e.g. the Files root matches the Tables root).
   */
  const hasBreadcrumbs = breadcrumbs != null && breadcrumbs.length > 1
  const rootCrumb = breadcrumbs?.length === 1 ? breadcrumbs[0] : undefined
  const TitleIcon = Icon ?? rootCrumb?.icon
  const titleLabel = title ?? rootCrumb?.label
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
      className='flex min-h-[48px] items-center border-[var(--border)] border-b px-4 py-[8.5px]'
    >
      <div className='flex min-w-0 flex-1 items-center justify-between gap-3'>
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
              /**
               * The first crumb on a nested page opens the hover "path" popover
               * (back-navigation). Single-crumb roots never reach here — they
               * render as the static title above.
               */
              const showLocationPopover = LocationIcon != null

              return (
                <Fragment key={`${crumb.label}-${i}`}>
                  {i > 0 && (
                    <span className='mx-0.5 shrink-0 select-none text-[var(--text-icon)] text-sm'>
                      /
                    </span>
                  )}
                  {showLocationPopover ? (
                    <BreadcrumbLocationPopover
                      icon={LocationIcon}
                      breadcrumbs={breadcrumbs}
                      className={segmentClassName}
                      veilBoundaryRef={headerRef}
                    />
                  ) : (
                    <BreadcrumbSegment
                      icon={LocationIcon ?? crumb.icon}
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
            /**
             * Root titles are short static labels ("Tables", "Files"), so the
             * span is non-shrinkable and the label never truncates — matching
             * the `shrink-0` guarantee the breadcrumb root crumb gets from
             * {@link getBreadcrumbSegmentClassName}. Without this, the
             * `flex-1` left column collapses during transient initial-load
             * layout (the JS-driven `--sidebar-width` settling) and the title
             * CSS-truncates to "T…" while the `shrink-0` actions hold width.
             */
            <span className={cn(chipGeometryClass, 'inline-flex shrink-0 cursor-default')}>
              {TitleIcon && <TitleIcon className={chipContentIconClass} />}
              {titleLabel && (
                <FloatingOverflowText
                  label={titleLabel}
                  className='block whitespace-nowrap text-[var(--text-body)] text-sm'
                />
              )}
            </span>
          )}
        </div>
        {(aside || (actions && actions.length > 0)) && (
          <div className='flex shrink-0 items-center'>
            {aside}
            {actions?.map((action) => (
              <Chip
                key={action.text}
                variant={action.variant}
                active={action.active}
                leftIcon={action.icon}
                onClick={action.onSelect}
                disabled={action.disabled}
              >
                {action.text}
              </Chip>
            ))}
          </div>
        )}
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
      <span className={cn(chipGeometryClass, 'inline-flex min-w-0 justify-start', className)}>
        {Icon && <Icon className={chipContentIconClass} />}
        <InlineRenameInput
          value={editing.value}
          onChange={editing.onChange}
          onSubmit={editing.onSubmit}
          onCancel={editing.onCancel}
          disabled={editing.disabled}
        />
      </span>
    )
  }

  const content = (
    <>
      {Icon && <Icon className={chipContentIconClass} />}
      <BreadcrumbLabel ref={labelRef} isOverflowing={isOverflowing} label={label} />
    </>
  )
  /**
   * Interactive crumbs use a plain `<button>` with bare-chip geometry — NEVER
   * the Button component, whose buttonVariants inject font-medium /
   * rounded-[5px] / justify-center and break chip parity with the static/title
   * crumbs.
   */
  const triggerClassName = cn(
    chipVariants({ flush: true }),
    'group min-w-0 max-w-full justify-start'
  )

  if (dropdownItems && dropdownItems.length > 0) {
    return (
      <>
        <DropdownMenu>
          <FloatingTooltip label={label} state={tooltipState} />
          <DropdownMenuTrigger asChild>
            <button type='button' className={cn(triggerClassName, className)} {...tooltipHandlers}>
              {content}
              <ChipChevronDown className='ml-auto' />
            </button>
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
        <button
          type='button'
          className={cn(triggerClassName, className)}
          onClick={onClick}
          {...tooltipHandlers}
        >
          {content}
        </button>
      </>
    )
  }

  return (
    <>
      <FloatingTooltip label={label} state={tooltipState} />
      <span
        className={cn(
          chipGeometryClass,
          'group inline-flex min-w-0 max-w-full cursor-default justify-start',
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

/**
 * Grace period before a hover-out dismisses the path popover. Covers the gap
 * the pointer crosses between the trigger and the popover content (and brief
 * jitter at their edges); re-entering either within this window cancels the
 * close. Standard hover-intent close delay — not tied to any navigation timing.
 */
const POPOVER_CLOSE_DELAY_MS = 120

function BreadcrumbLocationPopover({
  icon: Icon,
  breadcrumbs,
  className,
  veilBoundaryRef,
}: BreadcrumbLocationPopoverProps) {
  const [open, setOpen] = useState(false)
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rootBreadcrumb = breadcrumbs[0]

  const cancelScheduledClose = () => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current)
      closeTimeoutRef.current = null
    }
  }

  /**
   * Hover-intent open. Driven only by pointer-/keyboard-enter — never by
   * pointer movement. This is what makes the popover dismiss cleanly on a
   * click-to-navigate: a stationary click fires no enter event, so once
   * {@link navigateAndClose} sets `open` false nothing re-opens it before the
   * route swaps. (A move-driven open would re-fire under the resting cursor and
   * flash the popover/veil back in mid-navigation.)
   */
  const openPopover = () => {
    cancelScheduledClose()
    setOpen(true)
  }

  const scheduleClose = () => {
    cancelScheduledClose()
    closeTimeoutRef.current = setTimeout(() => {
      setOpen(false)
      closeTimeoutRef.current = null
    }, POPOVER_CLOSE_DELAY_MS)
  }

  /**
   * Closes the popover up front, then runs the crumb's handler. Closing first
   * lets the veil fade and the popover play its exit animation instead of
   * snapping away when navigation unmounts the header.
   */
  const navigateAndClose = (onClick?: () => void) => {
    if (!onClick) return
    cancelScheduledClose()
    setOpen(false)
    onClick()
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
            onClick={() => navigateAndClose(rootBreadcrumb?.onClick)}
            onFocus={openPopover}
            onBlur={scheduleClose}
            onMouseEnter={openPopover}
            onMouseLeave={scheduleClose}
            className={cn(
              chipVariants({ flush: true }),
              'max-w-none gap-1.5 px-2 transition-colors',
              open && 'relative z-[var(--z-popover)]',
              className
            )}
          >
            <span className='relative inline-grid size-[16px] shrink-0 place-items-center'>
              <Icon className='col-start-1 row-start-1 size-[16px] text-[var(--text-icon)] opacity-100 blur-0 transition-[opacity,filter,transform] duration-200 ease-in-out group-hover:scale-[0.25] group-hover:opacity-0 group-hover:blur-[2px] group-focus-visible:scale-[0.25] group-focus-visible:opacity-0 group-focus-visible:blur-[2px] motion-reduce:transition-none' />
              <ArrowUpLeft
                strokeWidth={1.55}
                className='col-start-1 row-start-1 size-[16px] scale-[0.25] text-[var(--text-icon)] opacity-0 blur-[2px] transition-[opacity,filter,transform] duration-200 ease-in-out group-hover:scale-100 group-hover:opacity-100 group-hover:blur-0 group-focus-visible:scale-100 group-focus-visible:opacity-100 group-focus-visible:blur-0 motion-reduce:transition-none'
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
                onClick={crumb.onClick ? () => navigateAndClose(crumb.onClick) : undefined}
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
  /**
   * Portal-mount gate. The veil must render `null` on BOTH the server render
   * and the first client (hydration) render — branching on
   * `typeof document === 'undefined'` made the two renders diverge, which
   * failed hydration and forced React to regenerate the whole page tree on
   * the client (a visible header flash during load).
   */
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

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

  if (!mounted) return null

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
          'min-w-0 truncate text-[var(--text-body)]',
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
