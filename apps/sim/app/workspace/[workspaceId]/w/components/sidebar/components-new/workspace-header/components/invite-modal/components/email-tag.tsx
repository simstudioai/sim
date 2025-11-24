import React from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface EmailTagProps {
  email: string
  onRemove: () => void
  disabled?: boolean
  isInvalid?: boolean
  isSent?: boolean
}

export const EmailTag = React.memo<EmailTagProps>(
  ({ email, onRemove, disabled, isInvalid, isSent }) => (
    <div
      className={cn(
        'flex w-auto items-center gap-[4px] rounded-[4px] border px-[6px] py-[2px] text-[12px]',
        isInvalid
          ? 'border-[var(--text-error)] bg-[color-mix(in_srgb,var(--text-error)_10%,transparent)] text-[var(--text-error)] dark:border-[var(--text-error)] dark:bg-[color-mix(in_srgb,var(--text-error)_16%,transparent)] dark:text-[var(--text-error)]'
          : 'border-[var(--surface-11)] bg-[var(--surface-5)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] dark:border-[var(--surface-11)] dark:bg-[var(--surface-5)] dark:text-[var(--text-secondary)] dark:hover:text-[var(--text-primary)]'
      )}
    >
      <span className='max-w-[200px] truncate'>{email}</span>
      {isSent && (
        <span className='text-[11px] text-[var(--text-tertiary)] dark:text-[var(--text-tertiary)]'>
          sent
        </span>
      )}
      {!disabled && !isSent && (
        <button
          type='button'
          onClick={onRemove}
          className={cn(
            'flex-shrink-0 transition-colors focus:outline-none',
            isInvalid
              ? 'text-[var(--text-error)] hover:text-[var(--text-error)] dark:text-[var(--text-error)] dark:hover:text-[var(--text-error)]'
              : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] dark:text-[var(--text-tertiary)] dark:hover:text-[var(--text-primary)]'
          )}
          aria-label={`Remove ${email}`}
        >
          <X className='h-[12px] w-[12px] translate-y-[0.2px]' />
        </button>
      )}
    </div>
  )
)

EmailTag.displayName = 'EmailTag'
