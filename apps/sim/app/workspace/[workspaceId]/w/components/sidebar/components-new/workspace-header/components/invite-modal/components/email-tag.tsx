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
        'flex w-auto items-center gap-[4px] rounded-[4px] border px-[8px] py-[4px] text-[12px]',
        isInvalid
          ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400'
          : 'border-[var(--surface-11)] bg-[var(--surface-5)] text-[var(--text-secondary)] dark:bg-[var(--surface-5)] dark:text-[var(--text-secondary)]'
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
              ? 'text-red-400 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300'
              : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] dark:text-[var(--text-tertiary)] dark:hover:text-[var(--text-primary)]'
          )}
          aria-label={`Remove ${email}`}
        >
          <X className='h-[14px] w-[14px]' />
        </button>
      )}
    </div>
  )
)

EmailTag.displayName = 'EmailTag'
