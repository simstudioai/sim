import type { ReactNode } from 'react'
import { Chip, Loader } from '@sim/emcn'
import { AUTH_BUTTON_CLASS } from '@/app/(auth)/components/constants'

interface AuthSubmitButtonProps {
  children: ReactNode
  /** Label shown beside the spinner while the action is in flight. */
  loadingLabel: string
  loading?: boolean
  disabled?: boolean
  type?: 'submit' | 'button'
  onClick?: () => void
}

/**
 * The canonical full-width primary auth action — a `primary`-variant {@link Chip}
 * with the shared in-flight spinner. Replaces the legacy dark
 * `AUTH_SUBMIT_BTN` class string for every in-scope auth submit (login, signup,
 * verify, reset), so the primary CTA chrome lives in exactly one place.
 */
export function AuthSubmitButton({
  children,
  loadingLabel,
  loading = false,
  disabled = false,
  type = 'submit',
  onClick,
}: AuthSubmitButtonProps) {
  return (
    <Chip
      variant='primary'
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      fullWidth
      flush
      className={AUTH_BUTTON_CLASS}
    >
      {loading ? (
        <span className='flex items-center gap-2'>
          <Loader className='size-4' animate />
          {loadingLabel}
        </span>
      ) : (
        children
      )}
    </Chip>
  )
}
