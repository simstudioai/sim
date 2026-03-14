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
import { cn } from '@/lib/core/utils/cn'

const ANIMATION_CLASSES =
  'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=open]:animate-in'

const DropdownMenu = DropdownMenuPrimitive.Root

const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger

const DropdownMenuGroup = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Group>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Group>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Group
    ref={ref}
    className={cn('flex flex-col gap-[2px]', className)}
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
  }
>(({ className, inset, children, ...props }, ref) => (
  <DropdownMenuPrimitive.SubTrigger
    ref={ref}
    className={cn(
      'flex min-w-0 cursor-default select-none items-center gap-[8px] rounded-[5px] px-[8px] py-[5px] font-medium text-[12px] text-[var(--text-body)] outline-none transition-colors focus:bg-[var(--surface-active)] data-[state=open]:bg-[var(--surface-active)] [&>span]:min-w-0 [&>span]:truncate [&_svg]:pointer-events-none [&_svg]:size-[14px] [&_svg]:shrink-0 [&_svg]:text-[var(--text-icon)]',
      inset && 'pl-[28px]',
      className
    )}
    {...props}
  >
    {children}
    <ChevronRight className='ml-auto shrink-0' />
  </DropdownMenuPrimitive.SubTrigger>
))
DropdownMenuSubTrigger.displayName = DropdownMenuPrimitive.SubTrigger.displayName

const DropdownMenuSubContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.SubContent
    ref={ref}
    className={cn(
      ANIMATION_CLASSES,
      'z-50 max-h-[240px] min-w-[8rem] max-w-[220px] origin-[--radix-dropdown-menu-content-transform-origin] overflow-y-auto overflow-x-hidden rounded-[8px] border border-[var(--border)] bg-[var(--bg)] p-[6px] text-[var(--text-body)] shadow-sm',
      className
    )}
    {...props}
  />
))
DropdownMenuSubContent.displayName = DropdownMenuPrimitive.SubContent.displayName

const DropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        ANIMATION_CLASSES,
        'z-50 max-h-[240px] min-w-[8rem] max-w-[220px] origin-[--radix-dropdown-menu-content-transform-origin] overflow-y-auto overflow-x-hidden rounded-[8px] border border-[var(--border)] bg-[var(--bg)] p-[6px] text-[var(--text-body)] shadow-sm',
        className
      )}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
))
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName

const DropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & {
    inset?: boolean
  }
>(({ className, inset, ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={cn(
      'relative flex min-w-0 cursor-pointer select-none items-center gap-[8px] rounded-[5px] px-[8px] py-[5px] font-medium text-[12px] text-[var(--text-body)] outline-none transition-colors focus:bg-[var(--surface-active)] data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&>span]:min-w-0 [&>span]:truncate [&_svg]:pointer-events-none [&_svg]:size-[14px] [&_svg]:shrink-0 [&_svg]:text-[var(--text-icon)]',
      inset && 'pl-[28px]',
      className
    )}
    {...props}
  />
))
DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName

const DropdownMenuCheckboxItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem>
>(({ className, children, checked, ...props }, ref) => (
  <DropdownMenuPrimitive.CheckboxItem
    ref={ref}
    className={cn(
      'relative flex cursor-default select-none items-center rounded-[5px] py-[5px] pr-[8px] pl-[28px] font-medium text-[12px] text-[var(--text-body)] outline-none transition-colors focus:bg-[var(--surface-active)] data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      className
    )}
    checked={checked}
    {...props}
  >
    <span className='absolute left-[8px] flex h-[14px] w-[14px] items-center justify-center'>
      <DropdownMenuPrimitive.ItemIndicator>
        <Check className='h-[14px] w-[14px]' />
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
      'relative flex cursor-default select-none items-center rounded-[5px] py-[5px] pr-[8px] pl-[28px] font-medium text-[12px] text-[var(--text-body)] outline-none transition-colors focus:bg-[var(--surface-active)] data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      className
    )}
    {...props}
  >
    <span className='absolute left-[8px] flex h-[14px] w-[14px] items-center justify-center'>
      <DropdownMenuPrimitive.ItemIndicator>
        <Circle className='h-[6px] w-[6px] fill-current' />
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
      'px-[8px] py-[5px] font-medium text-[11px] text-[var(--text-tertiary)]',
      inset && 'pl-[28px]',
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
    className={cn('-mx-[6px] my-[6px] h-px bg-[var(--border-1)]', className)}
    {...props}
  />
))
DropdownMenuSeparator.displayName = DropdownMenuPrimitive.Separator.displayName

const stopPropagation = (e: React.KeyboardEvent) => e.stopPropagation()

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
    <div className='mx-[2px] mt-[2px] mb-[2px] flex shrink-0 items-center gap-[8px] rounded-[5px] border border-[var(--border-1)] bg-[var(--surface-5)] px-[8px] dark:bg-[var(--surface-4)]'>
      <Search className='h-[14px] w-[14px] shrink-0 text-[var(--text-muted)]' />
      <input
        ref={setRefs}
        onKeyDown={(e) => {
          stopPropagation(e)
          onKeyDown?.(e)
        }}
        className={cn(
          'w-full bg-transparent py-[4px] font-medium text-[12px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:outline-none',
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
      className={cn('ml-auto text-[11px] text-[var(--text-muted)] tracking-widest', className)}
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
