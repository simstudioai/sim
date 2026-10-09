/**
 * Dropdown menu component built on Radix UI primitives with EMCN styling.
 * Provides accessible, animated dropdown menus with consistent design tokens.
 *
 * @example
 * ```tsx
 * <DropdownMenu>
 *   <DropdownMenuTrigger asChild>
 *     <Button>Open</Button>
 *   </DropdownMenuTrigger>
 *   <DropdownMenuContent>
 *     <DropdownMenuLabel>Actions</DropdownMenuLabel>
 *     <DropdownMenuSeparator />
 *     <DropdownMenuItem>Edit</DropdownMenuItem>
 *     <DropdownMenuItem>Delete</DropdownMenuItem>
 *   </DropdownMenuContent>
 * </DropdownMenu>
 * ```
 */

'use client'

import * as React from 'react'
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import { POPOVER_ANIMATION_CLASSES, RowActions, rowActionsGroupClass } from '@sim/emcn'
import { cva, type VariantProps } from 'class-variance-authority'
import { chipGeometryClass } from '#chip-chrome'
import { MENU_STYLES } from '#menu-styles'
import { Check, ChevronRight, Circle, Search } from '../../icons'
import { cn } from '../../lib/cn'
import { InsideModalContext } from '../modal/modal'
import { OverflowText, type OverflowTextProps } from '../overflow-text/overflow-text'

/**
 * Rows settle instantly, matching the sidebar (`[&_.group.cursor-pointer]:duration-0`
 * on its `aside`). A menu is walked, not read: at the default 150ms the fill lags a
 * cursor dragged down the list and two or three rows are mid-fade at once, which reads
 * as smear rather than as one row following the pointer. `transition-colors` stays so a
 * consumer can opt a row back into a duration.
 */
const MENU_ROW_TRANSITION_CLASS = 'transition-colors duration-0'

/**
 * The two row surfaces, mirroring `chipHoverSurfaceClass` / `chipActiveSurfaceClass`
 * — mutually exclusive, so a selected row holds its surface through hover instead of
 * dimming to the hover fill under the cursor.
 *
 * Highlight is keyed off `focus:`, not `hover:`: Radix moves DOM focus to the row on
 * pointer-move, so one selector covers both the pointer and the arrow-key cursor.
 * Rows previously highlighted to `--surface-active` — the *selected* surface — so a
 * hovered row looked selected and a menu appeared to have two selections at once. The
 * `group-*` variants are inert outside the `action` layout, which is the only place a
 * `group/dropdownitem` ancestor exists.
 */
const MENU_ROW_HIGHLIGHT_CLASS =
  'focus:bg-[var(--surface-hover)] group-focus-within/dropdownitem:bg-[var(--surface-hover)] group-hover/dropdownitem:bg-[var(--surface-hover)]'
/** @see {@link MENU_ROW_HIGHLIGHT_CLASS} — the selected half of the same pair. */
const MENU_ROW_SELECTED_CLASS =
  'bg-[var(--surface-active)] focus:bg-[var(--surface-active)] group-focus-within/dropdownitem:bg-[var(--surface-active)] group-hover/dropdownitem:bg-[var(--surface-active)]'

/**
 * Rows are a fixed height, so a label that wraps overflows its row and paints
 * over its neighbours instead of growing the row. Every row is therefore held
 * to one line, and its label uses the shared overflow treatment — see
 * {@link withOverflowLabel}.
 */
const MENU_ROW_SINGLE_LINE_CLASS =
  'whitespace-nowrap [&>span]:min-w-0 [&>span:not([data-overflow-text])]:overflow-hidden [&>span:not([data-overflow-text])]:text-clip'

type DropdownMenuItemLabelProps = Omit<OverflowTextProps, 'focusTarget'>

/** Canonical fade-only label for a menu row with icons, checks, or actions. */
const DropdownMenuItemLabel = React.memo(function DropdownMenuItemLabel({
  className,
  ...props
}: DropdownMenuItemLabelProps) {
  return (
    <OverflowText
      {...props}
      className={cn('flex-1', className)}
      focusTarget='nearest-interactive'
    />
  )
})

/**
 * Wraps a row's bare text children in a truncating box so a label wider than
 * the menu uses the platform overflow treatment rather than being cut mid-word
 * at the surface edge. Consumer-provided rich spans get a fade-free hard clip;
 * human labels with adjacent icons/actions use {@link DropdownMenuItemLabel}.
 *
 * Adjacent text is coalesced into a single box: a row is a flex container, so
 * wrapping `Insert row {n}` as two boxes would make them two flex items and
 * open the row's `gap` between the words. `React.Children.toArray` keys the
 * element children it returns, so the rebuilt array needs no keys of its own.
 */
function withOverflowLabel(children: React.ReactNode): React.ReactNode {
  const rebuilt: React.ReactNode[] = []
  let text: Array<string | number> = []
  const flushText = () => {
    if (text.length === 0) return
    rebuilt.push(
      <DropdownMenuItemLabel key={`label-${rebuilt.length}`} label={text.join('')}>
        {text}
      </DropdownMenuItemLabel>
    )
    text = []
  }
  for (const child of React.Children.toArray(children)) {
    if (typeof child === 'string' || typeof child === 'number') {
      text.push(child)
      continue
    }
    flushText()
    rebuilt.push(child)
  }
  flushText()
  return rebuilt
}

/** Caps long lists to the viewport while leaving ordinary action menus unscrolled. */
const MENU_MAX_HEIGHT_CLASS = 'max-h-[min(420px,var(--radix-popper-available-height,420px))]'

/**
 * Root and submenu surfaces share the platform's 12px floating corner, a 4px
 * gutter around the chip-radius rows, and the standard medium elevation.
 */
const CONTENT_BASE_CLASSES = `z-[var(--z-popover)] ${MENU_MAX_HEIGHT_CLASS} min-w-[8rem] origin-[--radix-dropdown-menu-content-transform-origin] overflow-y-auto overflow-x-hidden overscroll-none ${MENU_STYLES.surface} ${MENU_STYLES.padding} max-md:min-w-0! max-md:max-w-[calc(100vw-1rem)]!`

/**
 * Menu root. Inside a `ModalContent` (Radix modal dialog) the menu is forced
 * modal regardless of the `modal` prop: a non-modal menu portals outside the
 * dialog's `react-remove-scroll` subtree, so its content cannot be
 * wheel-scrolled, and it cannot coordinate focus with the dialog's trap. A
 * modal menu mounts its own scroll lock and focus scope, which layer correctly
 * over the dialog's. Outside dialogs the prop passes through untouched, so
 * page-level menus keep their consumer-chosen (or Radix-default) modality.
 */
function DropdownMenu({
  modal,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  const insideModal = React.useContext(InsideModalContext)
  return <DropdownMenuPrimitive.Root modal={insideModal ? true : modal} {...props} />
}

const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger

const DropdownMenuSub = DropdownMenuPrimitive.Sub

const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup

const DropdownMenuSubTrigger = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger> & {
    inset?: boolean
    asChild?: boolean
  }
>(({ className, inset, children, asChild, onPointerLeave, ...props }, ref) => {
  const handlePointerLeave = (event: React.PointerEvent<HTMLDivElement>) => {
    onPointerLeave?.(event)
    if (event.defaultPrevented) return
    const submenuId = event.currentTarget.getAttribute('aria-controls')
    const submenu = submenuId && event.currentTarget.ownerDocument.getElementById(submenuId)
    /** Direct portal entry must not depend on Radix's last in-parent pointer direction. */
    if (event.relatedTarget instanceof Node && submenu && submenu.contains(event.relatedTarget)) {
      event.preventDefault()
    }
  }
  if (asChild) {
    return (
      <DropdownMenuPrimitive.SubTrigger
        ref={ref}
        asChild
        className={className}
        {...props}
        onPointerLeave={handlePointerLeave}
      >
        {children}
      </DropdownMenuPrimitive.SubTrigger>
    )
  }
  return (
    <DropdownMenuPrimitive.SubTrigger
      ref={ref}
      onPointerLeave={handlePointerLeave}
      className={cn(
        /* An open submenu keeps its trigger on the selected surface — including while
           the pointer is on it, so walking into the submenu doesn't drop the trigger
           back to the hover fill. */
        `${MENU_STYLES.rowLayout} ${MENU_STYLES.sizes.md.className} cursor-default select-none text-[var(--text-body)] outline-hidden ${MENU_ROW_TRANSITION_CLASS} ${MENU_ROW_HIGHLIGHT_CLASS} data-[state=open]:bg-[var(--surface-active)] data-[state=open]:focus:bg-[var(--surface-active)] ${MENU_ROW_SINGLE_LINE_CLASS} [&_svg]:pointer-events-none [&_svg]:size-[14px] [&_svg]:shrink-0 [&_svg]:text-[var(--text-icon)]`,
        inset && 'pl-7',
        className
      )}
      {...props}
    >
      {withOverflowLabel(children)}
      <ChevronRight className='ml-auto size-[14px] shrink-0' />
    </DropdownMenuPrimitive.SubTrigger>
  )
})
DropdownMenuSubTrigger.displayName = DropdownMenuPrimitive.SubTrigger.displayName

const DropdownMenuSubContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.SubContent
      ref={ref}
      className={cn(POPOVER_ANIMATION_CLASSES, CONTENT_BASE_CLASSES, 'max-w-[280px]', className)}
      {...props}
      data-native-surface-overlay=''
    />
  </DropdownMenuPrimitive.Portal>
))
DropdownMenuSubContent.displayName = DropdownMenuPrimitive.SubContent.displayName

/**
 * Props for {@link DropdownMenuContent}.
 *
 * Extends Radix's `DropdownMenu.Content` props with `onOpenAutoFocus`. Radix
 * forwards this prop to the internal `FocusScope` (`onMountAutoFocus`) at
 * runtime, but its public `DropdownMenuContentProps` type omits it. We surface
 * it here so consumers can prevent the default open-focus behavior — useful
 * when a sibling input must retain focus while the menu mounts.
 */
interface DropdownMenuContentProps
  extends React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content> {
  /**
   * Fires when the content mounts and focus is about to move into it. Call
   * `event.preventDefault()` to skip Radix's auto-focus.
   */
  onOpenAutoFocus?: (event: Event) => void
}

const DropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  DropdownMenuContentProps
>(({ className, sideOffset = 6, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(POPOVER_ANIMATION_CLASSES, CONTENT_BASE_CLASSES, 'max-w-[220px]', className)}
      {...props}
      data-native-surface-overlay=''
    />
  </DropdownMenuPrimitive.Portal>
))
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName

/**
 * The canonical menu-row chrome, exported for the rare consumer that cannot use
 * {@link DropdownMenuItem} itself.
 *
 * Radix tracks every `DropdownMenuItem` in a focus Collection, so a list that
 * mounts and unmounts rows as a query narrows makes its FocusScope restore focus
 * to the content root mid-keystroke. Such a list renders plain `<button role="menuitem">`
 * elements instead — but it must still LOOK like a menu row, and hand-rolling that
 * is how the `@`-mention list drifted to its own gap, radius, height and text size.
 * Compose this instead of restating the literals.
 */
export const dropdownMenuRowClass = `relative ${MENU_STYLES.rowLayout} ${MENU_STYLES.sizes.md.className} cursor-pointer select-none text-[var(--text-body)] outline-hidden ${MENU_ROW_TRANSITION_CLASS} data-[disabled]:pointer-events-none data-[disabled]:opacity-50 ${MENU_ROW_SINGLE_LINE_CLASS} [&_svg]:pointer-events-none [&_svg]:size-[14px] [&_svg]:shrink-0 [&_svg]:text-[var(--text-icon)]`

/** Large rows match the sidebar's chip geometry without changing menu behavior. */
const dropdownMenuItemVariants = cva(dropdownMenuRowClass, {
  variants: {
    size: { default: '', lg: chipGeometryClass },
  },
  defaultVariants: { size: 'default' },
})

const DropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> &
    VariantProps<typeof dropdownMenuItemVariants> & {
      inset?: boolean
      /**
       * Renders the row as selected — the current route, the checked value, the row
       * whose own menu is open. Selected is a state the row *holds*, so it keeps
       * `--surface-active` through hover rather than dimming to the hover fill.
       *
       * Not for a pointer/keyboard cursor: that is the row highlight, which the row
       * already paints on its own. A menu that marks its cursor row `active` puts two
       * selections on screen.
       */
      active?: boolean
      /**
       * Optional inline action rendered on the right edge of the item — e.g. a
       * "more" icon button. Reveals on hover/focus of the row, and the row stays
       * highlighted while the cursor is over the action. ArrowRight moves from
       * the row to its action; ArrowLeft returns to the row.
       */
      action?: React.ReactNode
      /** Keeps the action visible while its portaled menu is open. */
      actionOpen?: boolean
      /** Idle indicator sharing the action slot on hover-capable devices. */
      actionIndicator?: React.ReactNode
    }
>(
  (
    {
      className,
      size,
      inset,
      active,
      action,
      actionOpen,
      actionIndicator,
      asChild,
      children,
      ...props
    },
    ref
  ) => {
    const actionRef = React.useRef<HTMLDivElement>(null)
    const content = asChild ? children : withOverflowLabel(children)
    const stateClasses = active ? MENU_ROW_SELECTED_CLASS : MENU_ROW_HIGHLIGHT_CLASS
    if (action) {
      return (
        <div
          className={cn('group/dropdownitem relative', rowActionsGroupClass)}
          onKeyDown={(event) => {
            if (
              event.defaultPrevented ||
              event.altKey ||
              event.ctrlKey ||
              event.metaKey ||
              event.shiftKey
            )
              return
            const row = event.currentTarget.firstElementChild
            const actionButton =
              actionRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')
            if (event.key === 'ArrowRight' && event.target === row && actionButton) {
              event.preventDefault()
              event.stopPropagation()
              actionButton.focus()
            } else if (
              event.key === 'ArrowLeft' &&
              row instanceof HTMLElement &&
              event.target instanceof Node &&
              actionRef.current?.contains(event.target)
            ) {
              event.preventDefault()
              event.stopPropagation()
              row.focus()
            }
          }}
        >
          <DropdownMenuPrimitive.Item
            ref={ref}
            className={cn(
              dropdownMenuItemVariants({ size }),
              stateClasses,
              actionIndicator || actionOpen
                ? 'pr-[28px]'
                : '[@media(hover:hover)]:group-focus-within/dropdownitem:pr-[28px] [@media(hover:hover)]:group-hover/dropdownitem:pr-[28px]',
              actionIndicator
                ? '[@media(any-pointer:coarse)]:pr-[52px] [@media(hover:none)]:pr-[52px]'
                : '[@media(any-pointer:coarse)]:pr-[28px] [@media(hover:none)]:pr-[28px]',
              inset && 'pl-7',
              className
            )}
            asChild={asChild}
            {...props}
          >
            {content}
          </DropdownMenuPrimitive.Item>
          <RowActions
            indicator={actionIndicator}
            open={actionOpen}
            actionRef={actionRef}
            className='-translate-y-1/2 absolute top-1/2 right-1'
          >
            {action}
          </RowActions>
        </div>
      )
    }
    return (
      <DropdownMenuPrimitive.Item
        ref={ref}
        className={cn(dropdownMenuItemVariants({ size }), stateClasses, inset && 'pl-7', className)}
        asChild={asChild}
        {...props}
      >
        {content}
      </DropdownMenuPrimitive.Item>
    )
  }
)
DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName

/**
 * Compact icon button intended to be used as the `action` slot on a
 * `DropdownMenuItem`. Click events are stopped from bubbling so they don't
 * trigger the parent item's selection.
 */
const DropdownMenuItemAction = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>(({ className, onClick, onPointerDown, ...props }, ref) => (
  <button
    ref={ref}
    type='button'
    onClick={(e) => {
      e.stopPropagation()
      e.preventDefault()
      onClick?.(e)
    }}
    onPointerDown={(e) => {
      e.stopPropagation()
      onPointerDown?.(e)
    }}
    className={cn(
      'flex size-[18px] shrink-0 items-center justify-center rounded-sm outline-hidden [&_svg]:pointer-events-none [&_svg]:size-[16px] [&_svg]:text-[var(--text-icon)]',
      className
    )}
    {...props}
  />
))
DropdownMenuItemAction.displayName = 'DropdownMenuItemAction'

const DropdownMenuCheckboxItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem>
>(({ className, children, checked, ...props }, ref) => (
  <DropdownMenuPrimitive.CheckboxItem
    ref={ref}
    className={cn(
      `relative ${MENU_STYLES.rowLayout} ${MENU_STYLES.sizes.md.className} cursor-default select-none whitespace-nowrap pl-7 text-[var(--text-body)] outline-hidden ${MENU_ROW_TRANSITION_CLASS} ${MENU_ROW_HIGHLIGHT_CLASS} data-[disabled]:pointer-events-none data-[disabled]:opacity-50`,
      className
    )}
    checked={checked}
    {...props}
  >
    <span className='absolute left-2 flex size-[14px] items-center justify-center'>
      <DropdownMenuPrimitive.ItemIndicator>
        <Check className='size-[14px]' />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {withOverflowLabel(children)}
  </DropdownMenuPrimitive.CheckboxItem>
))
DropdownMenuCheckboxItem.displayName = DropdownMenuPrimitive.CheckboxItem.displayName

const DropdownMenuRadioItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.RadioItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.RadioItem>
>(({ className, children, ...props }, ref) => (
  <DropdownMenuPrimitive.RadioItem
    ref={ref}
    className={cn(
      `relative ${MENU_STYLES.rowLayout} ${MENU_STYLES.sizes.md.className} cursor-default select-none whitespace-nowrap pl-7 text-[var(--text-body)] outline-hidden ${MENU_ROW_TRANSITION_CLASS} ${MENU_ROW_HIGHLIGHT_CLASS} data-[disabled]:pointer-events-none data-[disabled]:opacity-50`,
      className
    )}
    {...props}
  >
    <span className='absolute left-2 flex size-[14px] items-center justify-center'>
      <DropdownMenuPrimitive.ItemIndicator>
        <Circle className='size-[6px] fill-current' />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {withOverflowLabel(children)}
  </DropdownMenuPrimitive.RadioItem>
))
DropdownMenuRadioItem.displayName = DropdownMenuPrimitive.RadioItem.displayName

/** Section heading on the menu row grid, one text step below its items. */
const DropdownMenuLabel = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label> & {
    inset?: boolean
  }
>(({ className, inset, ...props }, ref) => (
  <DropdownMenuPrimitive.Label
    ref={ref}
    className={cn(MENU_STYLES.heading, inset && 'pl-7', className)}
    {...props}
  />
))
DropdownMenuLabel.displayName = DropdownMenuPrimitive.Label.displayName

const DropdownMenuSeparator = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Separator
    ref={ref}
    className={cn(MENU_STYLES.separator, className)}
    {...props}
  />
))
DropdownMenuSeparator.displayName = DropdownMenuPrimitive.Separator.displayName

const DropdownMenuSearchInput = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, onKeyDown, ...props }, ref) => {
  const internalRef = React.useRef<HTMLInputElement | null>(null)

  React.useEffect(() => {
    internalRef.current?.focus()
  }, [])

  const setRefs = React.useCallback(
    (node: HTMLInputElement | null) => {
      internalRef.current = node
      if (typeof ref === 'function') ref(node)
      else if (ref) ref.current = node
    },
    [ref]
  )

  /*
   * No horizontal margin: the field spans the same width as the rows beneath it,
   * both inset only by the surface's `p-1`. It carried `mx-0.5` and so sat 2px
   * narrower on each side. The vertical margins stay — the search field is a
   * sibling of the item groups, not a member of one, so no container gap
   * separates it from the first row.
   */
  return (
    <div className={MENU_STYLES.search}>
      <Search className='size-[14px] shrink-0 text-[var(--text-muted)]' />
      <input
        ref={setRefs}
        onKeyDown={(e) => {
          e.stopPropagation()
          onKeyDown?.(e)
        }}
        className={cn(MENU_STYLES.searchInput, className)}
        {...props}
      />
    </div>
  )
})
DropdownMenuSearchInput.displayName = 'DropdownMenuSearchInput'

const DropdownMenuShortcut = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => {
  return (
    <span
      className={cn(
        'ml-auto shrink-0 pl-3 text-[var(--text-muted)] text-caption tabular-nums',
        className
      )}
      {...props}
    />
  )
}
DropdownMenuShortcut.displayName = 'DropdownMenuShortcut'

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuItemLabel,
  DropdownMenuItemAction,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSearchInput,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuRadioGroup,
}
