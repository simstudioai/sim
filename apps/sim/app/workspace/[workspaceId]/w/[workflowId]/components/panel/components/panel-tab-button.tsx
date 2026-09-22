import { type ComponentProps, forwardRef } from 'react'
import { Button, cn } from '@sim/emcn'

interface PanelTabButtonProps
  extends Omit<ComponentProps<typeof Button>, 'variant' | 'size' | 'iconSize' | 'iconPadding'> {
  active: boolean
}

/** The workflow panel's compact tab treatment, with caller-owned selection. */
export const PanelTabButton = forwardRef<HTMLButtonElement, PanelTabButtonProps>(
  ({ active, className, ...props }, ref) => (
    <Button
      {...props}
      ref={ref}
      variant={active ? 'active' : 'ghost'}
      className={cn(
        'h-[28px] rounded-md border py-[5px] text-small',
        active
          ? 'border-[var(--border-1)]'
          : 'border-transparent hover-hover:border-[var(--border-1)] hover-hover:bg-[var(--surface-5)]',
        className
      )}
    />
  )
)
PanelTabButton.displayName = 'PanelTabButton'
