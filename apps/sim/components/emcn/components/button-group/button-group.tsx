'use client'

import {
  Children,
  cloneElement,
  createContext,
  type HTMLAttributes,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useContext,
} from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/core/utils/cn'

const buttonGroupVariants = cva('inline-flex', {
  variants: {
    gap: {
      none: 'gap-0',
      sm: 'gap-[2px]',
    },
  },
  defaultVariants: {
    gap: 'sm',
  },
})

interface ButtonGroupContextValue {
  value: string | undefined
  onValueChange: ((value: string) => void) | undefined
  disabled: boolean
}

const ButtonGroupContext = createContext<ButtonGroupContextValue | null>(null)

function useButtonGroupContext() {
  const context = useContext(ButtonGroupContext)
  if (!context) {
    throw new Error('ButtonGroupItem must be used within a ButtonGroup')
  }
  return context
}

export interface ButtonGroupProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'>,
    VariantProps<typeof buttonGroupVariants> {
  /** Currently selected value */
  value?: string
  /** Callback fired when selection changes */
  onValueChange?: (value: string) => void
  /** Disables all items in the group */
  disabled?: boolean
  children: ReactNode
}

/**
 * A group of connected toggle buttons where only one can be selected.
 *
 * @example
 * ```tsx
 * <ButtonGroup value={language} onValueChange={setLanguage}>
 *   <ButtonGroupItem value="curl">cURL</ButtonGroupItem>
 *   <ButtonGroupItem value="python">Python</ButtonGroupItem>
 *   <ButtonGroupItem value="javascript">JavaScript</ButtonGroupItem>
 * </ButtonGroup>
 * ```
 */
function ButtonGroup({
  className,
  gap,
  value,
  onValueChange,
  disabled = false,
  children,
  ...props
}: ButtonGroupProps) {
  const validChildren = Children.toArray(children).filter(isValidElement)
  const childCount = validChildren.length

  return (
    <ButtonGroupContext.Provider value={{ value, onValueChange, disabled }}>
      <div role='group' className={cn(buttonGroupVariants({ gap }), className)} {...props}>
        {validChildren.map((child, index) => {
          const position: 'first' | 'middle' | 'last' | 'only' =
            childCount === 1
              ? 'only'
              : index === 0
                ? 'first'
                : index === childCount - 1
                  ? 'last'
                  : 'middle'

          return cloneElement(child as ReactElement<ButtonGroupItemProps>, {
            _position: position,
          })
        })}
      </div>
    </ButtonGroupContext.Provider>
  )
}

const buttonGroupItemVariants = cva(
  'inline-flex items-center justify-center font-medium transition-colors outline-none focus:outline-none focus-visible:outline-none disabled:pointer-events-none disabled:opacity-70 px-[8px] py-[4px] text-[12px] border',
  {
    variants: {
      active: {
        true: 'bg-[var(--brand-tertiary-2)] text-[var(--text-inverse)] border-[var(--brand-tertiary-2)] hover:brightness-106',
        false:
          'bg-[var(--surface-4)] text-[var(--text-secondary)] border-[var(--border)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-6)] hover:border-[var(--border-1)]',
      },
      position: {
        only: 'rounded-[5px]',
        first: 'rounded-l-[5px] rounded-r-none',
        middle: 'rounded-none',
        last: 'rounded-r-[5px] rounded-l-none',
      },
    },
    defaultVariants: {
      active: false,
      position: 'only',
    },
  }
)

export interface ButtonGroupItemProps extends Omit<HTMLAttributes<HTMLButtonElement>, 'onClick'> {
  /** Value associated with this item */
  value: string
  /** Disables this specific item */
  disabled?: boolean
  /** @internal Position within the group, set automatically */
  _position?: 'first' | 'middle' | 'last' | 'only'
}

/**
 * An individual item within a ButtonGroup.
 */
function ButtonGroupItem({
  className,
  value,
  disabled: itemDisabled,
  _position = 'only',
  children,
  ...props
}: ButtonGroupItemProps) {
  const context = useButtonGroupContext()
  const isActive = context.value === value
  const isDisabled = context.disabled || itemDisabled

  const handleClick = () => {
    if (!isDisabled && context.onValueChange) {
      context.onValueChange(value)
    }
  }

  return (
    <button
      type='button'
      role='radio'
      aria-checked={isActive}
      disabled={isDisabled}
      onClick={handleClick}
      className={cn(buttonGroupItemVariants({ active: isActive, position: _position }), className)}
      {...props}
    >
      {children}
    </button>
  )
}

ButtonGroup.displayName = 'ButtonGroup'
ButtonGroupItem.displayName = 'ButtonGroupItem'

export { ButtonGroup, ButtonGroupItem, buttonGroupVariants, buttonGroupItemVariants }
