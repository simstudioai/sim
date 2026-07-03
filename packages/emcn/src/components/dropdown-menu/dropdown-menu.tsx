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
import { Check, ChevronRight, Circle, Search } from 'lucide-react'
import { cn } from '../../lib/cn'
import { chipFieldSurfaceClass } from '../chip/chip-chrome'
import { InsideModalContext } from '../modal/modal'

const ANIMATION_CLASSES =
  'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=open]:animate-in motion-reduce:animate-none'

const CONTENT_BASE_CLASSES =
  'z-[var(--z-popover)] max-h-[240px] min-w-[8rem] origin-[--radix-dropdown-menu-content-transform-origin] overflow-y-auto overflow-x-hidden overscroll-none border border-[var(--border)] bg-[var(--bg)] p-1.5 text-[var(--text-body)] shadow-sm'

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
  <DropdownMenuPrimitive.Group
    ref={ref}
    className={cn('flex flex-col gap-0.5', className)}
    {...props}
  />
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
        'flex h-[30px] min-w-0 cursor-default select-none items-center gap-2 rounded-lg px-2 text-[var(--text-body)] text-small outline-none transition-colors focus:bg-[var(--surface-active)] data-[state=open]:bg-[var(--surface-active)] [&>span]:min-w-0 [&>span]:truncate [&_svg]:pointer-events-none [&_svg]:size-[14px] [&_svg]:shrink-0 [&_svg]:text-[var(--text-icon)]',
        inset && 'pl-7',
        className
      )}
      {...props}
    >
      {children}
      <ChevronRight className='ml-auto shrink-0' />
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
      className={cn(ANIMATION_CLASSES, CONTENT_BASE_CLASSES, 'max-w-[280px] rounded-lg', className)}
      {...props}
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
      className={cn(ANIMATION_CLASSES, CONTENT_BASE_CLASSES, 'max-w-[220px] rounded-xl', className)}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
))
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName

const DROPDOWN_MENU_ITEM_BASE_CLASSES =
  'relative flex h-[30px] min-w-0 cursor-pointer select-none items-center gap-2 rounded-lg px-2 text-[var(--text-body)] text-small outline-none transition-colors focus:bg-[var(--surface-active)] data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&>span]:min-w-0 [&>span]:truncate [&_svg]:pointer-events-none [&_svg]:size-[14px] [&_svg]:shrink-0 [&_svg]:text-[var(--text-icon)]'

const DropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & {
    inset?: boolean
    /**
     * Optional inline action rendered on the right edge of the item — e.g. a
     * "more" icon button. Reveals on hover/focus of the row, and the row stays
     * highlighted while the cursor is over the action.
     */
    action?: React.ReactNode
  }
>(({ className, inset, action, ...props }, ref) => {
  if (action) {
    return (
      <div className='group/dropdownitem relative'>
        <DropdownMenuPrimitive.Item
          ref={ref}
          className={cn(
            DROPDOWN_MENU_ITEM_BASE_CLASSES,
            'pr-[28px] group-focus-within/dropdownitem:bg-[var(--surface-active)] group-hover/dropdownitem:bg-[var(--surface-active)]',
            inset && 'pl-7',
            className
          )}
          {...props}
        />
        <div className='-translate-y-1/2 absolute top-1/2 right-1 flex items-center opacity-0 transition-opacity group-focus-within/dropdownitem:opacity-100 group-hover/dropdownitem:opacity-100'>
          {action}
        </div>
      </div>
    )
  }
  return (
    <DropdownMenuPrimitive.Item
      ref={ref}
      className={cn(DROPDOWN_MENU_ITEM_BASE_CLASSES, inset && 'pl-7', className)}
      {...props}
    />
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
      'relative flex h-[30px] cursor-default select-none items-center rounded-lg pr-2 pl-7 text-[var(--text-body)] text-small outline-none transition-colors focus:bg-[var(--surface-active)] data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
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
    {children}
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
      'relative flex h-[30px] cursor-default select-none items-center rounded-lg pr-2 pl-7 text-[var(--text-body)] text-small outline-none transition-colors focus:bg-[var(--surface-active)] data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      className
    )}
    {...props}
  >
    <span className='absolute left-2 flex size-[14px] items-center justify-center'>
      <DropdownMenuPrimitive.ItemIndicator>
        <Circle className='size-[6px] fill-current' />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.RadioItem>
))
DropdownMenuRadioItem.displayName = DropdownMenuPrimitive.RadioItem.displayName

const DropdownMenuLabel = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label> & {
    inset?: boolean
  }
>(({ className, inset, ...props }, ref) => (
  <DropdownMenuPrimitive.Label
    ref={ref}
    className={cn(
      'px-2 py-1.5 font-medium text-[var(--text-tertiary)] text-xs',
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
    className={cn('my-1.5 h-px bg-[var(--border-1)]', className)}
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

  return (
    <div
      className={cn(
        'mx-0.5 mt-0.5 mb-0.5 flex h-[30px] shrink-0 items-center gap-2 px-2',
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
