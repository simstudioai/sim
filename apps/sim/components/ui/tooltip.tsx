'use client'

import * as React from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { cn } from '@/lib/utils'

const TooltipProvider = TooltipPrimitive.Provider

const Tooltip = TooltipPrimitive.Root

const TooltipTrigger = TooltipPrimitive.Trigger

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content> & {
    command?: string
    commandPosition?: 'inline' | 'below'
  }
>(({ className, sideOffset = 8, command, commandPosition = 'inline', ...props }, ref) => (
  <TooltipPrimitive.Content
    ref={ref}
    sideOffset={sideOffset}
    className={cn(
      'fade-in-0 zoom-in-95 data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 animate-in overflow-hidden rounded-md bg-black px-3 py-1.5 text-white text-xs shadow-md data-[state=closed]:animate-out dark:bg-white dark:text-black',
      className
    )}
    {...props}
  >
    {props.children}
    {command && commandPosition === 'inline' && (
      <span className='pl-2 text-white/80 dark:text-black/70'>{command}</span>
    )}
    {command && commandPosition === 'below' && (
      <div className='pt-[1px] text-white/80 dark:text-black/70'>{command}</div>
    )}
  </TooltipPrimitive.Content>
))
TooltipContent.displayName = TooltipPrimitive.Content.displayName

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
