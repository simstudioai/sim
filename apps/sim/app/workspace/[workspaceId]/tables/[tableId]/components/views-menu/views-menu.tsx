'use client'

import { memo, useEffect, useRef, useState } from 'react'
import {
  Button,
  ChipChevronDown,
  ChipConfirmModal,
  chipContentLabelClass,
  chipVariants,
  cn,
  OverflowText,
  POPOVER_ANIMATION_CLASSES,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverItem,
  PopoverSection,
  Tooltip,
} from '@sim/emcn'
import { Check, Pencil, Pin, Plus, Trash } from '@sim/emcn/icons'
import type { TableViewWire } from '@/lib/api/contracts/tables'
import { resolveTableViewSelection } from '@/app/workspace/[workspaceId]/tables/[tableId]/view-state'

/** Legacy label for tables that do not yet have a persisted default view. */
export const ALL_ROWS_VIEW_LABEL = 'All'

/** Matches the breadcrumb location popover's hover-intent grace period. */
const POPOVER_CLOSE_DELAY_MS = 120

/** Rendered width of one action button (`p-1` + `size-3` glyph) plus its `gap-0.5`.
 *  The row reserves `actionCount` of these, so keep it in step with the button
 *  classes below — the overlay is absolutely positioned and can't size the spacer. */
const VIEW_ACTION_SLOT_PX = 22

interface ViewsMenuProps {
  views: TableViewWire[]
  /** `null` selects the legacy "All" state while a table awaits backfill. */
  activeViewId: string | null
  onSelect: (viewId: string | null) => void
  onRename: (viewId: string) => void
  onSetDefault: (viewId: string) => void
  onDelete: (viewId: string) => void
  /** Starts a blank view — named first, configured after. */
  onNewView: () => void
  /** Read-only members can switch views but not modify them. */
  canEdit: boolean
}

/**
 * View switcher for the table options bar. Carries the active view's name, or
 * resolves an absent selection to the persisted default while the URL catches up.
 *
 * Opens on hover-intent like the header's breadcrumb location popover, so the
 * list of views is discoverable without a click.
 */
export const ViewsMenu = memo(function ViewsMenu({
  views,
  activeViewId,
  onSelect,
  onRename,
  onSetDefault,
  onDelete,
  onNewView,
  canEdit,
}: ViewsMenuProps) {
  const [open, setOpen] = useState(false)
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { activeView, defaultView } = resolveTableViewSelection(views, activeViewId)
  const deleteTarget = views.find((view) => view.id === deleteTargetId)
  const hasDefaultView = defaultView !== null
  const label = activeView?.name ?? ALL_ROWS_VIEW_LABEL

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
          <OverflowText
            label={label}
            className={cn('flex-1', chipContentLabelClass)}
            focusTarget='nearest-interactive'
          />
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
          'bg-[var(--bg)] p-1.5 text-[var(--text-body)] shadow-xs'
        )}
        onMouseEnter={openPopover}
        onMouseLeave={scheduleClose}
        onFocusCapture={cancelScheduledClose}
      >
        <PopoverSection className='px-1.5 py-0.5 text-[var(--text-muted)] text-xs'>
          Views
        </PopoverSection>
        <div className='flex flex-col gap-0.5'>
          {!hasDefaultView && (
            <ViewRow
              label={ALL_ROWS_VIEW_LABEL}
              isActive={activeViewId === null}
              onSelect={() => runAndClose(() => onSelect(null))}
            />
          )}
          {views.map((view) => (
            <ViewRow
              key={view.id}
              label={view.name}
              isActive={view.id === activeViewId}
              onSelect={() => runAndClose(() => onSelect(view.id))}
              defaultState={{
                isDefault: view.isDefault,
                onSetDefault:
                  canEdit && !view.isDefault
                    ? () => {
                        cancelScheduledClose()
                        onSetDefault(view.id)
                      }
                    : undefined,
              }}
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
                        disabledReason: view.isDefault
                          ? 'Default view cannot be deleted'
                          : undefined,
                        onClick: () => runAndClose(() => setDeleteTargetId(view.id)),
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
              <OverflowText label='New view' className='flex-1 text-left' />
            </PopoverItem>
          </>
        )}
      </PopoverContent>
      <ChipConfirmModal
        open={deleteTargetId !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setDeleteTargetId(null)
        }}
        srTitle='Delete View'
        title='Delete View'
        text={[
          'Are you sure you want to delete ',
          { text: deleteTarget?.name ?? 'this view', bold: true },
          '? ',
          { text: 'This action cannot be undone.', error: true },
        ]}
        confirm={{
          label: 'Delete',
          onClick: () => {
            if (!deleteTargetId) return
            onDelete(deleteTargetId)
            setDeleteTargetId(null)
          },
        }}
      />
    </Popover>
  )
})

interface ViewRowAction {
  icon: React.ElementType
  label: string
  onClick: () => void
  /** Renders the action inert and dimmed, with this text in its hover tooltip. */
  disabledReason?: string
}

interface ViewRowDefaultState {
  isDefault: boolean
  onSetDefault?: () => void
}

interface ViewRowProps {
  label: string
  isActive: boolean
  onSelect: () => void
  defaultState?: ViewRowDefaultState
  actions?: ViewRowAction[]
}

/**
 * One row: a full-width select target with the per-view actions laid out beside
 * the label rather than over it. The actions occupy real layout width (revealed
 * on hover via opacity, not `display`) so the name never reflows or sits
 * underneath them.
 */
function ViewRow({ label, isActive, onSelect, defaultState, actions }: ViewRowProps) {
  const actionCount = (actions?.length ?? 0) + (defaultState ? 1 : 0)

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
        <OverflowText label={label} className='flex-1 text-left' />
        {actionCount > 0 && (
          <span
            aria-hidden
            className='shrink-0'
            style={{ width: actionCount * VIEW_ACTION_SLOT_PX }}
          />
        )}
      </PopoverItem>
      {actionCount > 0 && (
        <div className='pointer-events-none absolute right-1.5 flex items-center gap-0.5'>
          {actions?.map((action) => {
            // Disabled via aria-disabled, not the `disabled` attribute: the button
            // must keep receiving hover and focus events so the tooltip can explain
            // why it is inert, and Button's disabled:opacity-70 would otherwise
            // leak it through the hidden (opacity-0) resting state.
            const button = (
              <Button
                key={action.label}
                type='button'
                variant='quiet'
                size='icon'
                aria-label={action.label}
                title={action.disabledReason ? undefined : action.label}
                aria-disabled={action.disabledReason ? true : undefined}
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  if (action.disabledReason) return
                  action.onClick()
                }}
                className={cn(
                  'pointer-events-none opacity-0 transition-[background-color,color,opacity] group-focus-within/view:pointer-events-auto group-hover/view:pointer-events-auto',
                  action.disabledReason
                    ? 'cursor-default hover-hover:bg-transparent group-focus-within/view:opacity-40 group-hover/view:opacity-40'
                    : 'group-focus-within/view:opacity-100 group-hover/view:opacity-100'
                )}
              >
                <action.icon className='size-3' />
              </Button>
            )
            return action.disabledReason ? (
              <Tooltip.Root key={action.label}>
                <Tooltip.Trigger asChild>{button}</Tooltip.Trigger>
                <Tooltip.Content>
                  <p>{action.disabledReason}</p>
                </Tooltip.Content>
              </Tooltip.Root>
            ) : (
              button
            )
          })}
          {defaultState && (
            <Button
              type='button'
              variant='quiet'
              size='icon'
              aria-label={defaultState.isDefault ? 'Current default view' : 'Set as default'}
              title={defaultState.isDefault ? 'Current default view' : 'Set as default'}
              disabled={!defaultState.onSetDefault}
              // A disabled Button defaults to pointer-events-none, which would let
              // clicks fall through this pointer-events-none overlay to the row and
              // select the view. Keeping the pin hit-testable swallows the click —
              // disabled buttons dispatch no click events — and shows its title.
              className='pointer-events-auto disabled:pointer-events-auto'
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                defaultState.onSetDefault?.()
              }}
            >
              <Pin className={cn('size-3', defaultState.isDefault && 'fill-current')} />
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
