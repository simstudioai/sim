'use client'
import type * as React from 'react'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { cn } from '@/lib/cn'

export const Popover = PopoverPrimitive.Root

export const PopoverTrigger = PopoverPrimitive.Trigger

export function PopoverContent({
  className,
  align = 'center',
  sideOffset = 4,
  ...props
}: React.ComponentPropsWithRef<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        side='bottom'
        className={cn(
          'z-50 max-h-(--radix-popover-content-available-height) min-w-[240px] max-w-[98vw] origin-(--radix-popover-content-transform-origin) overflow-y-auto rounded-xl border bg-fd-popover/60 p-2 text-fd-popover-foreground text-sm shadow-lg backdrop-blur-lg focus-visible:outline-none data-[state=closed]:animate-fd-popover-out data-[state=open]:animate-fd-popover-in',
          className
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}

export const PopoverClose = PopoverPrimitive.PopoverClose
