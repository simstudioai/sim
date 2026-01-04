'use client'

import * as React from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { cn } from '@/lib/core/utils/cn'

/**
 * Tooltip provider component that must wrap your app or tooltip usage area.
 */
const Provider = TooltipPrimitive.Provider

/**
 * Root tooltip component that wraps trigger and content.
 */
const Root = TooltipPrimitive.Root

/**
 * Trigger element that activates the tooltip on hover.
 */
const Trigger = TooltipPrimitive.Trigger

/**
 * Tooltip content component with consistent styling.
 *
 * @example
 * ```tsx
 * <Tooltip.Root>
 *   <Tooltip.Trigger asChild>
 *     <Button>Hover me</Button>
 *   </Tooltip.Trigger>
 *   <Tooltip.Content>
 *     <p>Tooltip text</p>
 *   </Tooltip.Content>
 * </Tooltip.Root>
 * ```
 */
const Content = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      collisionPadding={8}
      avoidCollisions={true}
      className={cn(
        'z-[10000300] rounded-[4px] bg-[#1b1b1b] px-[8px] py-[3.5px] font-base text-white text-xs shadow-sm dark:bg-[#fdfdfd] dark:text-black',
        className
      )}
      {...props}
    >
      {props.children}
      <TooltipPrimitive.Arrow className='fill-[#1b1b1b] dark:fill-[#fdfdfd]' />
    </TooltipPrimitive.Content>
  </TooltipPrimitive.Portal>
))
Content.displayName = TooltipPrimitive.Content.displayName

export const Tooltip = {
  Root,
  Trigger,
  Content,
  Provider,
}
