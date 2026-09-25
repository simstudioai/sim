import { type ComponentPropsWithoutRef, forwardRef } from 'react'
import { Plus } from '../../icons/plus'
import { cn } from '../../lib/cn'
import { Button } from '../button/button'

export type AddRowButtonProps = ComponentPropsWithoutRef<'button'>

/**
 * Full-width dashed action for adding the first row to an empty editor list.
 * Keeps the existing 28px filter/sort treatment; list state stays with the caller.
 * Forwards native button props and refs, preserving Button's native form behavior.
 *
 * @example <AddRowButton onClick={addRule}>Add filter condition</AddRowButton>
 */
export const AddRowButton = forwardRef<HTMLButtonElement, AddRowButtonProps>(
  ({ children, className, ...props }, ref) => (
    <Button
      {...props}
      ref={ref}
      variant='ghost'
      className={cn(
        'h-7 w-full justify-start gap-1.5 border border-[var(--border-1)] border-dashed text-[var(--text-muted)] text-small',
        className
      )}
    >
      <Plus className='size-[14px]' />
      {children}
    </Button>
  )
)

AddRowButton.displayName = 'AddRowButton'
