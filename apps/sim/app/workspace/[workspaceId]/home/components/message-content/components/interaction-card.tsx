import { forwardRef, type InputHTMLAttributes, type MouseEventHandler, type ReactNode } from 'react'
import { ArrowRight, cn } from '@sim/emcn'

export const INTERACTION_CARD_ROW_CLASSES =
  'flex items-center gap-2 border-[var(--border)] px-2 py-2 text-left transition-colors'

export const INTERACTION_CARD_TEXT_INPUT_CLASSES =
  'min-w-0 flex-1 border-0 bg-transparent p-0 text-[var(--text-body)] text-sm outline-none placeholder:text-[var(--text-muted)] disabled:cursor-not-allowed'

export interface InteractionCardRecapItem {
  label: string
  values: readonly string[]
}

interface InteractionCardProps {
  children: ReactNode
  title?: ReactNode
  actions?: ReactNode
  className?: string
}

/**
 * Shared chat-inline card chrome for terminal UI tags that need user input.
 * Question choices and credential controls use this same shell so their
 * spacing, border, surface, and header remain visually identical.
 */
export function InteractionCard({ children, title, actions, className }: InteractionCardProps) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-[var(--border-1)] bg-[var(--white)] px-2.5 py-2 dark:bg-[var(--surface-4)]',
        className
      )}
    >
      {title !== undefined && (
        <div className='flex items-center justify-between gap-2 px-2 py-2'>
          <p className='min-w-0 flex-1 break-words text-[var(--text-primary)] text-sm'>{title}</p>
          {actions}
        </div>
      )}
      {children}
    </div>
  )
}

interface InteractionCardRecapProps {
  items: readonly InteractionCardRecapItem[]
}

/** Shared answered-state layout used by questions and credential requests. */
export function InteractionCardRecap({ items }: InteractionCardRecapProps) {
  return (
    <InteractionCard>
      {items.map((item, index) => (
        <div key={`${item.label}-${index}`} className='px-2 py-2'>
          <p className='text-[var(--text-primary)] text-sm'>{item.label}</p>
          <div className='mt-1.5 flex flex-col gap-1 text-[var(--text-muted)] text-sm'>
            {item.values.map((value, valueIndex) => (
              <p key={`${value}-${valueIndex}`}>{value}</p>
            ))}
          </div>
        </div>
      ))}
    </InteractionCard>
  )
}

export interface InteractionCardInputRowProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> {
  divided?: boolean
  leading?: ReactNode
  trailing?: ReactNode
  inputClassName?: string
}

/** Shared inline-input row used by question free text and credential secrets. */
export const InteractionCardInputRow = forwardRef<HTMLInputElement, InteractionCardInputRowProps>(
  ({ divided = false, leading, trailing, inputClassName, ...inputProps }, ref) => (
    <div className={cn(INTERACTION_CARD_ROW_CLASSES, divided && 'border-t')}>
      {leading}
      <input
        ref={ref}
        className={cn(INTERACTION_CARD_TEXT_INPUT_CLASSES, inputClassName)}
        {...inputProps}
      />
      {trailing}
    </div>
  )
)
InteractionCardInputRow.displayName = 'InteractionCardInputRow'

interface InteractionCardActionRowProps {
  label: string
  leading?: ReactNode
  disabled?: boolean
  onClick: MouseEventHandler<HTMLButtonElement>
}

/** Shared terminal action row used for question and credential submission. */
export function InteractionCardActionRow({
  label,
  leading,
  disabled = false,
  onClick,
}: InteractionCardActionRowProps) {
  return (
    <button
      type='button'
      disabled={disabled}
      onClick={onClick}
      className={cn(
        INTERACTION_CARD_ROW_CLASSES,
        'border-t',
        disabled ? 'cursor-not-allowed' : 'hover-hover:bg-[var(--surface-5)]'
      )}
    >
      {leading}
      <span
        className={cn(
          'flex-1 truncate text-sm',
          disabled ? 'text-[var(--text-muted)]' : 'text-[var(--text-body)]'
        )}
      >
        {label}
      </span>
      <ArrowRight className='size-[16px] shrink-0 text-[var(--text-icon)]' />
    </button>
  )
}
