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
import { Check, ChevronRight, Circle, Search } from '../../icons'
import { cn } from '../../lib/cn'
import { chipContentGap, chipFieldSurfaceClass } from '../chip/chip-chrome'
import { InsideModalContext } from '../modal/modal'
import { OverflowText } from '../overflow-text/overflow-text'

const ANIMATION_CLASSES =
  'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=open]:animate-in motion-reduce:animate-none'

/**
 * Menu row geometry. Rows sit 2px flatter than the 30px chip pill — the menu is a
 * dense list, not a stack of pills — but keep the shared 8px control corner (see
 * the surface note below). Every row (item, checkbox, radio, submenu trigger,
 * search field) composes these, so the rhythm cannot drift the way it did when
 * each row hardcoded its own height and radius.
 *
 * The icon↔label gap is {@link chipContentGap}, not a local literal. It was `gap-2`
 * (8px) against the platform's 6px, and on the menu's 14px icons — narrower than the
 * chip's 16px — the extra 2px read as the row's content drifting apart rather than as
 * one icon/label pair. Importing the token is also what keeps a menu row and the
 * sidebar chip it opens over from spacing their content differently.
 */
const MENU_ROW_HEIGHT_CLASS = 'h-[28px]'
const MENU_ROW_RADIUS_CLASS = 'rounded-lg'

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
  'whitespace-nowrap [&>span]:min-w-0 [&>span:not([data-overflow-text])]:truncate'

/**
 * Wraps a row's bare text children in a truncating box so a label wider than
 * the menu uses the platform overflow treatment rather than being cut mid-word
 * at the surface edge. Consumer-provided direct `<span>` labels retain an
 * ellipsis fallback; a canonical {@link OverflowText} owns its fade and tooltip.
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
      <OverflowText key={`label-${rebuilt.length}`} label={text.join('')}>
        {text}
      </OverflowText>
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

/**
 * A menu is capped so a long data-driven list — every workflow, every folder —
 * scrolls instead of running the height of the screen. The cap has to clear the
 * tallest hand-authored action menu though, or an ordinary right-click menu
 * scrolls for the sake of a few pixels: the knowledge-base row menu is 231px
 * (7 rows x 28px + 3 separators x 9px + 8px padding), which a flat 240px cap
 * once clipped while the shorter Files row menu next to it did not. 420px clears
 * every action menu in the app with room for a couple more rows.
 *
 * `min()` with Radix's measured space then keeps the menu inside the viewport
 * when it opens near an edge. The popper var (rather than the
 * `--radix-dropdown-menu-content-*` alias) because submenu content portals
 * outside the root menu and only inherits the popper one; the fallback covers
 * the case where collision detection is off and no space is measured at all.
 */
const MENU_MAX_HEIGHT_CLASS = 'max-h-[min(420px,var(--radix-popper-available-height,420px))]'

/**
 * Surface corner, shared by the root menu and submenus — they previously
 * disagreed, at 12px and 8px.
 *
 * `rounded-xl`/`rounded-lg` here are the platform's two-tier radius convention,
 * not a value tuned for this menu: every floating surface takes the 12px corner
 * ({@link Modal}, {@link ChipModal}, {@link Popover} content) and every row or
 * control inside one takes 8px (the chip, `Popover` items, `ChipModal` fields,
 * {@link Tooltip}). A menu that picks its own pair reads as a different family of
 * object next to the surfaces it opens over, so match the convention rather than
 * making the two corners strictly concentric.
 *
 * The 4px surface padding then makes them concentric anyway — 8px row + 4px pad is
 * exactly the 12px surface corner, so a first or last row's rounding now tracks the
 * corner it sits in instead of cutting across it. It was 6px, which both broke that
 * and gave the menu a wider gutter than its own 8px row padding; two consumers had
 * already overridden it back down to 4px by hand.
 */
const CONTENT_BASE_CLASSES = `z-[var(--z-popover)] ${MENU_MAX_HEIGHT_CLASS} min-w-[8rem] origin-[--radix-dropdown-menu-content-transform-origin] overflow-y-auto overflow-x-hidden overscroll-none rounded-xl border border-[var(--border)] bg-[var(--bg)] p-1 text-[var(--text-body)] shadow-sm`

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

const DropdownMenuGroup = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Group>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Group>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Group ref={ref} className={cn('flex flex-col', className)} {...props} />
))
DropdownMenuGroup.displayName = DropdownMenuPrimitive.Group.displayName

const DropdownMenuPortal = DropdownMenuPrimitive.Portal

const DropdownMenuSub = DropdownMenuPrimitive.Sub

const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup

const DropdownMenuSubTrigger = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger> & {
    inset?: boolean
    asChild?: boolean
  }
>(({ className, inset, children, asChild, ...props }, ref) => {
  if (asChild) {
    return (
      <DropdownMenuPrimitive.SubTrigger ref={ref} asChild className={className} {...props}>
        {children}
      </DropdownMenuPrimitive.SubTrigger>
    )
  }
  return (
    <DropdownMenuPrimitive.SubTrigger
      ref={ref}
      className={cn(
        /* An open submenu keeps its trigger on the selected surface — including while
           the pointer is on it, so walking into the submenu doesn't drop the trigger
           back to the hover fill. */
        `flex ${MENU_ROW_HEIGHT_CLASS} min-w-0 cursor-default select-none items-center ${chipContentGap} ${MENU_ROW_RADIUS_CLASS} px-2 text-[var(--text-body)] text-small outline-none ${MENU_ROW_TRANSITION_CLASS} ${MENU_ROW_HIGHLIGHT_CLASS} data-[state=open]:bg-[var(--surface-active)] data-[state=open]:focus:bg-[var(--surface-active)] ${MENU_ROW_SINGLE_LINE_CLASS} [&_svg]:pointer-events-none [&_svg]:size-[14px] [&_svg]:shrink-0 [&_svg]:text-[var(--text-icon)]`,
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
      className={cn(ANIMATION_CLASSES, CONTENT_BASE_CLASSES, 'max-w-[280px]', className)}
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
      className={cn(ANIMATION_CLASSES, CONTENT_BASE_CLASSES, 'max-w-[220px]', className)}
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
export const dropdownMenuRowClass = `relative flex ${MENU_ROW_HEIGHT_CLASS} min-w-0 cursor-pointer select-none items-center ${chipContentGap} ${MENU_ROW_RADIUS_CLASS} px-2 text-[var(--text-body)] text-small outline-none ${MENU_ROW_TRANSITION_CLASS} data-[disabled]:pointer-events-none data-[disabled]:opacity-50 ${MENU_ROW_SINGLE_LINE_CLASS} [&_svg]:pointer-events-none [&_svg]:size-[14px] [&_svg]:shrink-0 [&_svg]:text-[var(--text-icon)]`

const DropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & {
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
     * highlighted while the cursor is over the action.
     */
    action?: React.ReactNode
  }
>(({ className, inset, active, action, asChild, children, ...props }, ref) => {
  const content = asChild ? children : withOverflowLabel(children)
  const stateClasses = active ? MENU_ROW_SELECTED_CLASS : MENU_ROW_HIGHLIGHT_CLASS
  if (action) {
    return (
      <div className='group/dropdownitem relative'>
        <DropdownMenuPrimitive.Item
          ref={ref}
          className={cn(
            dropdownMenuRowClass,
            stateClasses,
            'pr-[28px]',
            inset && 'pl-7',
            className
          )}
          asChild={asChild}
          {...props}
        >
          {content}
        </DropdownMenuPrimitive.Item>
        <div className='-translate-y-1/2 absolute top-1/2 right-1 flex items-center opacity-0 transition-opacity group-focus-within/dropdownitem:opacity-100 group-hover/dropdownitem:opacity-100'>
          {action}
        </div>
      </div>
    )
  }
  return (
    <DropdownMenuPrimitive.Item
      ref={ref}
      className={cn(dropdownMenuRowClass, stateClasses, inset && 'pl-7', className)}
      asChild={asChild}
      {...props}
    >
      {content}
    </DropdownMenuPrimitive.Item>
  )
})
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
      'flex size-[18px] flex-shrink-0 items-center justify-center rounded-sm outline-none [&_svg]:pointer-events-none [&_svg]:size-[16px] [&_svg]:text-[var(--text-icon)]',
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
      `relative flex ${MENU_ROW_HEIGHT_CLASS} min-w-0 cursor-default select-none items-center ${MENU_ROW_RADIUS_CLASS} whitespace-nowrap pr-2 pl-7 text-[var(--text-body)] text-small outline-none ${MENU_ROW_TRANSITION_CLASS} ${MENU_ROW_HIGHLIGHT_CLASS} data-[disabled]:pointer-events-none data-[disabled]:opacity-50`,
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
      `relative flex ${MENU_ROW_HEIGHT_CLASS} min-w-0 cursor-default select-none items-center ${MENU_ROW_RADIUS_CLASS} whitespace-nowrap pr-2 pl-7 text-[var(--text-body)] text-small outline-none ${MENU_ROW_TRANSITION_CLASS} ${MENU_ROW_HIGHLIGHT_CLASS} data-[disabled]:pointer-events-none data-[disabled]:opacity-50`,
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

/**
 * Section heading above a group of rows.
 *
 * Composes {@link MENU_ROW_HEIGHT_CLASS} rather than padding to a height. It was
 * `py-1.5` over `text-xs`, and nothing in the app sets a `line-height`, so its box
 * resolved through the browser's default leading — roughly 25px, font-dependent,
 * and the only child of the menu not on the 28px row grid. Every row beneath it
 * therefore sat ~3px off that grid too.
 *
 * `text-caption` and `--text-muted` come from the platform's two other list
 * headings — the command palette's group heading and the sidebar's section header
 * — which both set a heading one step below their own rows in `--text-muted`. The
 * menu's rows are `text-small`, so one step down is `text-caption`; `text-xs` was
 * two. `--text-tertiary` was also darker than `--text-muted`, so the heading
 * out-weighed the rows it introduces.
 */
const DropdownMenuLabel = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label> & {
    inset?: boolean
  }
>(({ className, inset, ...props }, ref) => (
  <DropdownMenuPrimitive.Label
    ref={ref}
    className={cn(
      `flex ${MENU_ROW_HEIGHT_CLASS} items-center px-2 text-[var(--text-muted)] text-caption`,
      inset && 'pl-7',
      className
    )}
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
    className={cn('my-1 h-px bg-[var(--border-1)]', className)}
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
    <div
      className={cn(
        `mt-0.5 mb-0.5 flex ${MENU_ROW_HEIGHT_CLASS} shrink-0 items-center ${chipContentGap} px-2`,
        chipFieldSurfaceClass
      )}
    >
      <Search className='size-[14px] shrink-0 text-[var(--text-muted)]' />
      <input
        ref={setRefs}
        onKeyDown={(e) => {
          e.stopPropagation()
          onKeyDown?.(e)
        }}
        className={cn(
          'h-full w-full bg-transparent text-[var(--text-body)] text-small outline-none placeholder:text-[var(--text-muted)] focus:outline-none',
          className
        )}
        {...props}
      />
    </div>
  )
})
DropdownMenuSearchInput.displayName = 'DropdownMenuSearchInput'

const DropdownMenuShortcut = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => {
  return (
    <span
      className={cn('ml-auto text-[var(--text-muted)] text-xs tracking-widest', className)}
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
  DropdownMenuItemAction,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSearchInput,
  DropdownMenuShortcut,
  DropdownMenuGroup,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuRadioGroup,
}
