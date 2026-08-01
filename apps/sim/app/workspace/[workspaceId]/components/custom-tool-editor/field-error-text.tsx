import type { ReactNode } from 'react'

/**
 * Inline error text for a custom-tool editor section header. Lives in the
 * header rather than under the editor because a tall editor plus a message
 * below it shifts everything after it as the message appears while typing.
 */
export function FieldErrorText({ children }: { children: ReactNode }) {
  return <span className='min-w-0 truncate text-[var(--text-error)] text-caption'>{children}</span>
}
