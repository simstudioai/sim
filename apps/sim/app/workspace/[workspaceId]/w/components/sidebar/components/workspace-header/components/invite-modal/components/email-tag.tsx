import React from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/core/utils/cn'

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
          ? 'border-[var(--text-error)] bg-[color-mix(in_srgb,var(--text-error)_10%,transparent)] text-[var(--text-error)] dark:bg-[color-mix(in_srgb,var(--text-error)_16%,transparent)]'
          : 'border-[var(--border-1)] bg-[var(--surface-4)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
      )}
    >
      <span className='max-w-[200px] truncate'>{email}</span>
      {isSent && <span className='text-[11px] text-[var(--text-tertiary)]'>sent</span>}
      {!disabled && !isSent && (
        <button
          type='button'
          onClick={onRemove}
          className={cn(
            'flex-shrink-0 transition-colors focus:outline-none',
            isInvalid
              ? 'text-[var(--text-error)] hover:text-[var(--text-error)]'
              : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
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
