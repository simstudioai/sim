import type { ReactNode } from 'react'
import { Label } from '@/components/emcn'

interface AuthFieldProps {
  /** Matches the `id` set on the control rendered as {@link children}. */
  htmlFor: string
  label: string
  /** Validation messages to render beneath the control. */
  errors?: string[]
  /** Optional right-aligned action shown next to the label (e.g. Forgot password). */
  action?: ReactNode
  /** The field control — a {@link ChipInput}/{@link PasswordInput}. */
  children: ReactNode
}

/**
 * A labeled form field row: canonical {@link Label}, an optional inline label
 * action, the control, and a validation-message list in the error token. The
 * control drives its own invalid chrome through its `error` prop — this wrapper
 * only owns the label row and the message list, so every auth field reads and
 * spaces identically.
 */
export function AuthField({ htmlFor, label, errors, action, children }: AuthFieldProps) {
  const hasErrors = Boolean(errors && errors.length > 0)
  return (
    <div className='space-y-2'>
      <div className='flex items-center justify-between'>
        <Label htmlFor={htmlFor}>{label}</Label>
        {action}
      </div>
      {children}
      {hasErrors && (
        <div className='space-y-1 text-[var(--text-error)] text-caption' aria-live='polite'>
          {errors?.map((error) => (
            <p key={error}>{error}</p>
          ))}
        </div>
      )}
    </div>
  )
}
