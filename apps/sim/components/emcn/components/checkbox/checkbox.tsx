'use client'

import * as React from 'react'
import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import { cva, type VariantProps } from 'class-variance-authority'
import { Check } from 'lucide-react'
import { cn } from '@/lib/core/utils/cn'

/**
 * Variant styles for the Checkbox component.
 * Controls size and visual style.
 *
 * @example
 * ```tsx
 * // Default checkbox
 * <Checkbox />
 *
 * // Small checkbox (for tables)
 * <Checkbox size="sm" />
 *
 * // Large checkbox
 * <Checkbox size="lg" />
 * ```
 */
const checkboxVariants = cva(
  'peer shrink-0 rounded-sm border border-[var(--border-1)] bg-[var(--surface-4)] ring-offset-background transition-colors hover:border-[var(--border-muted)] hover:bg-[var(--surface-7)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[state=checked]:border-[var(--text-muted)] data-[state=checked]:bg-[var(--text-muted)] data-[state=checked]:text-white dark:bg-[var(--surface-5)] dark:data-[state=checked]:border-[var(--surface-7)] dark:data-[state=checked]:bg-[var(--surface-7)] dark:data-[state=checked]:text-[var(--text-primary)] dark:hover:border-[var(--surface-7)] dark:hover:bg-[var(--border-1)]',
  {
    variants: {
      size: {
        sm: 'h-[14px] w-[14px]',
        md: 'h-4 w-4',
        lg: 'h-5 w-5',
      },
    },
    defaultVariants: {
      size: 'md',
    },
  }
)

/**
 * Variant styles for the Checkbox indicator icon.
 */
const checkboxIconVariants = cva('stroke-[3]', {
  variants: {
    size: {
      sm: 'h-[10px] w-[10px]',
      md: 'h-3.5 w-3.5',
      lg: 'h-4 w-4',
    },
  },
  defaultVariants: {
    size: 'md',
  },
})

export interface CheckboxProps
  extends React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>,
    VariantProps<typeof checkboxVariants> {}

/**
 * A checkbox component with size variants.
 *
 * @example
 * ```tsx
 * // Basic usage
 * <Checkbox checked={checked} onCheckedChange={setChecked} />
 *
 * // Small checkbox for tables
 * <Checkbox size="sm" checked={isSelected} onCheckedChange={handleSelect} />
 *
 * // With label
 * <div className="flex items-center gap-2">
 *   <Checkbox id="terms" />
 *   <Label htmlFor="terms">Accept terms</Label>
 * </div>
 * ```
 */
const Checkbox = React.forwardRef<React.ElementRef<typeof CheckboxPrimitive.Root>, CheckboxProps>(
  ({ className, size, ...props }, ref) => (
    <CheckboxPrimitive.Root
      ref={ref}
      className={cn(checkboxVariants({ size }), className)}
      {...props}
    >
      <CheckboxPrimitive.Indicator className={cn('flex items-center justify-center text-current')}>
        <Check className={cn(checkboxIconVariants({ size }))} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
)
Checkbox.displayName = CheckboxPrimitive.Root.displayName

export { Checkbox, checkboxVariants, checkboxIconVariants }
