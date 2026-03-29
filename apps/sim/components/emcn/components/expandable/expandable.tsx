'use client'

import * as React from 'react'
import * as CollapsiblePrimitive from '@radix-ui/react-collapsible'
import { cn } from '@/lib/core/utils/cn'

/**
 * Expandable root that controls the open/closed state.
 * Wraps Radix Collapsible.Root with the `open` prop mapped from `expanded`.
 *
 * @example
 * ```tsx
 * const [open, setOpen] = useState(false)
 * <button onClick={() => setOpen(!open)}>Toggle</button>
 * <Expandable expanded={open}>
 *   <ExpandableContent>
 *     <p>This content animates in/out smoothly.</p>
 *   </ExpandableContent>
 * </Expandable>
 * ```
 */
interface ExpandableProps
  extends Omit<React.ComponentPropsWithoutRef<typeof CollapsiblePrimitive.Root>, 'open'> {
  /** Whether the content is expanded */
  expanded: boolean
}

const Expandable = React.forwardRef<
  React.ElementRef<typeof CollapsiblePrimitive.Root>,
  ExpandableProps
>(({ expanded, className, ...props }, ref) => (
  <CollapsiblePrimitive.Root
    ref={ref}
    open={expanded}
    className={cn('w-full', className)}
    {...props}
  />
))
Expandable.displayName = 'Expandable'

/**
 * Animated content container for the Expandable.
 * Uses Radix Collapsible.Content with CSS height animation via
 * `--radix-collapsible-content-height` custom property.
 */
const ExpandableContent = React.forwardRef<
  React.ElementRef<typeof CollapsiblePrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof CollapsiblePrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <CollapsiblePrimitive.Content
    ref={ref}
    className={cn(
      'overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down',
      className
    )}
    {...props}
  >
    {children}
  </CollapsiblePrimitive.Content>
))
ExpandableContent.displayName = 'ExpandableContent'

export { Expandable, ExpandableContent }
