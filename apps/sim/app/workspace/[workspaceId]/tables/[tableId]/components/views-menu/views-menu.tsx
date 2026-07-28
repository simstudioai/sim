'use client'

import { memo, useEffect, useRef, useState } from 'react'
import {
  ChipChevronDown,
  chipContentLabelClass,
  chipVariants,
  cn,
  POPOVER_ANIMATION_CLASSES,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverItem,
  PopoverSection,
} from '@sim/emcn'
import { Check, Pencil, Plus, Trash } from '@sim/emcn/icons'
import type { TableViewWire } from '@/lib/api/contracts/tables'

/** Label for the built-in unfiltered state. Not a stored row — `null` view id. */
export const ALL_ROWS_VIEW_LABEL = 'All'

/** Matches the breadcrumb location popover's hover-intent grace period. */
const POPOVER_CLOSE_DELAY_MS = 120

/** Rendered width of one action button (`p-1` + `size-3` glyph) plus its `gap-0.5`.
 *  The row reserves `actions.length` of these, so keep it in step with the button
 *  classes below — the overlay is absolutely positioned and can't size the spacer. */
const VIEW_ACTION_SLOT_PX = 22

interface ViewsMenuProps {
  views: TableViewWire[]
  /** `null` selects the built-in "All" state. */
  activeViewId: string | null
  onSelect: (viewId: string | null) => void
  onRename: (viewId: string) => void
  onDelete: (viewId: string) => void
  /** Starts a blank view — named first, configured after. */
  onNewView: () => void
  /** Read-only members can switch views but not modify them. */
  canEdit: boolean
}

/**
 * View switcher for the table options bar. Reads "View" until one is selected,
 * then carries the active view's name.
 *
 * Opens on hover-intent like the header's breadcrumb location popover, so the
 * list of views is discoverable without a click.
 */
export const ViewsMenu = memo(function ViewsMenu({
  views,
  activeViewId,
  onSelect,
  onRename,
  onDelete,
  onNewView,
  canEdit,
}: ViewsMenuProps) {
  const [open, setOpen] = useState(false)
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const activeView = activeViewId ? views.find((view) => view.id === activeViewId) : undefined
  const label = activeView?.name ?? 'View'

  const cancelScheduledClose = () => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current)
      closeTimeoutRef.current = null
    }
  }

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

  /** Closes up front so the popover plays its exit animation instead of snapping
   *  away when a selection re-renders the bar. */
  const runAndClose = (action: () => void) => {
    cancelScheduledClose()
    setOpen(false)
    action()
  }

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current)
    }
  }, [])

  return (
    <Popover size='md' open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <button
          type='button'
          aria-label='Views'
          onClick={openPopover}
          onFocus={openPopover}
          onBlur={scheduleClose}
          onMouseEnter={openPopover}
          onMouseLeave={scheduleClose}
          className={cn(chipVariants(), 'max-w-[220px]')}
        >
          <span className={chipContentLabelClass}>{label}</span>
          <ChipChevronDown />
        </button>
      </PopoverAnchor>
      <PopoverContent
        side='bottom'
        align='start'
        sideOffset={6}
        minWidth={240}
        maxWidth={320}
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
          Views
        </PopoverSection>
        <div className='flex flex-col gap-0.5'>
          <ViewRow
            label={ALL_ROWS_VIEW_LABEL}
            isActive={activeViewId === null}
            onSelect={() => runAndClose(() => onSelect(null))}
          />
          {views.map((view) => (
            <ViewRow
              key={view.id}
              label={view.name}
              isActive={view.id === activeViewId}
              isDefault={view.isDefault}
              onSelect={() => runAndClose(() => onSelect(view.id))}
              actions={
                canEdit
                  ? [
                      {
                        icon: Pencil,
                        label: 'Rename',
                        onClick: () => runAndClose(() => onRename(view.id)),
                      },
                      {
                        icon: Trash,
                        label: 'Delete',
                        onClick: () => runAndClose(() => onDelete(view.id)),
                      },
                    ]
                  : undefined
              }
            />
          ))}
        </div>
        {canEdit && (
          <>
            <div className='my-1 h-px bg-[var(--border)]' />
            <PopoverItem
              onClick={() => runAndClose(onNewView)}
              className='h-7 items-center gap-1.5 px-1.5 py-0 text-xs'
            >
              <span className='flex size-[14px] shrink-0 items-center justify-center'>
                <Plus className='size-3 text-[var(--text-icon)]' />
              </span>
              <span className='min-w-0 flex-1 truncate text-left'>New view</span>
            </PopoverItem>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
})

interface ViewRowAction {
  icon: React.ElementType
  label: string
  onClick: () => void
}

interface ViewRowProps {
  label: string
  isActive: boolean
  isDefault?: boolean
  onSelect: () => void
  actions?: ViewRowAction[]
}

/**
 * One row: a full-width select target with the per-view actions laid out beside
 * the label rather than over it. The actions occupy real layout width (revealed
 * on hover via opacity, not `display`) so the name never reflows or sits
 * underneath them.
 */
function ViewRow({ label, isActive, isDefault, onSelect, actions }: ViewRowProps) {
  return (
    <div className='group/view relative flex items-center'>
      <PopoverItem
        active={isActive}
        onClick={onSelect}
        className='h-7 min-w-0 flex-1 items-center gap-1.5 px-1.5 py-0 text-xs'
      >
        <span className='flex size-[14px] shrink-0 items-center justify-center'>
          {isActive && <Check className='size-3 text-[var(--text-icon)]' />}
        </span>
        <span className='min-w-0 flex-1 truncate text-left'>{label}</span>
        {isDefault && (
          <span className='shrink-0 text-[var(--text-muted)] text-micro group-hover/view:hidden'>
            Default
          </span>
        )}
        {actions && (
          <span
            aria-hidden
            className='shrink-0'
            style={{ width: actions.length * VIEW_ACTION_SLOT_PX }}
          />
        )}
      </PopoverItem>
      {actions && (
        <div className='pointer-events-none absolute right-1.5 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/view:pointer-events-auto group-hover/view:opacity-100'>
          {actions.map((action) => (
            <button
              key={action.label}
              type='button'
              aria-label={action.label}
              title={action.label}
              // The row behind is a select-the-view target; without stopping
              // propagation every action would also switch to that view.
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                action.onClick()
              }}
              className='rounded-md p-1 text-[var(--text-icon)] transition-colors hover-hover:bg-[var(--surface-active)] hover-hover:text-[var(--text-body)]'
            >
              <action.icon className='size-3' />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
