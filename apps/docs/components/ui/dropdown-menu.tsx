'use client'

import type { ComponentPropsWithRef } from 'react'
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import { cn } from '@/lib/utils'

const ANIMATION_CLASSES =
  'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=open]:animate-in motion-reduce:animate-none'

/**
 * Menu surface mirrored from the emcn `DropdownMenu`
 * (`apps/sim/components/emcn/components/dropdown-menu/dropdown-menu.tsx`) —
 * `--bg` surface, `--border` outline, `rounded-xl`, `p-1.5`.
 */
const CONTENT_BASE_CLASSES =
  'z-50 max-h-[240px] min-w-[8rem] origin-[var(--radix-dropdown-menu-content-transform-origin)] overflow-y-auto overflow-x-hidden overscroll-none border border-[var(--border)] bg-[var(--bg)] p-1.5 font-season text-[var(--text-body)] shadow-sm'

const DropdownMenu = DropdownMenuPrimitive.Root
const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger

function DropdownMenuContent({
  className,
  sideOffset = 6,
  ref,
  ...props
}: ComponentPropsWithRef<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn(
          ANIMATION_CLASSES,
          CONTENT_BASE_CLASSES,
          'max-w-[220px] rounded-xl',
          className
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  )
}

function DropdownMenuItem({
  className,
  ref,
  ...props
}: ComponentPropsWithRef<typeof DropdownMenuPrimitive.Item>) {
  return (
    <DropdownMenuPrimitive.Item
      ref={ref}
      className={cn(
        'relative flex h-[30px] min-w-0 cursor-pointer select-none items-center gap-2 rounded-lg px-2 text-[13px] text-[var(--text-body)] outline-none transition-colors focus:bg-[var(--surface-active)] data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&>span]:min-w-0 [&>span]:truncate [&_svg]:pointer-events-none [&_svg]:size-[14px] [&_svg]:shrink-0 [&_svg]:text-[var(--text-icon)]',
        className
      )}
      {...props}
    />
  )
}

export { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem }
