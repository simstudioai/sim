'use client'

import * as React from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { cn } from '@/lib/utils'

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
  <TooltipPrimitive.Content
    ref={ref}
    sideOffset={sideOffset}
    collisionPadding={8}
    avoidCollisions={true}
    className={cn(
      'z-[60] rounded-[3px] bg-black px-[7.5px] py-[6px] font-base text-white text-xs shadow-md dark:bg-white dark:text-black',
      className
    )}
    {...props}
  >
    {props.children}
    <TooltipPrimitive.Arrow className='fill-black dark:fill-white' />
  </TooltipPrimitive.Content>
))
Content.displayName = TooltipPrimitive.Content.displayName

export const Tooltip = {
  Root,
  Trigger,
  Content,
  Provider,
}
