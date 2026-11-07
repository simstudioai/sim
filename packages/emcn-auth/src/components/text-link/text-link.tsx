import type { ReactNode } from 'react'
import { clsx } from 'clsx'
import styles from '#auth/components/text-link/text-link.module.css'

interface AuthTextLinkProps {
  children: ReactNode
  href?: string
  onClick?: () => void
  external?: boolean
  disabled?: boolean
  className?: string
}
/** Renders a document link when href is provided, otherwise a button; disabled blocks either action. */
export function AuthTextLink({
  children,
  href,
  onClick,
  external,
  disabled,
  className,
}: AuthTextLinkProps) {
  const classes = clsx(styles.textLink, className)
  return href ? (
    <a
      data-auth-text-link=''
      href={disabled ? undefined : href}
      role={disabled ? 'link' : undefined}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : undefined}
      onClick={disabled ? undefined : onClick}
      className={classes}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    >
      {children}
    </a>
  ) : (
    <button
      data-auth-text-link=''
      type='button'
      onClick={onClick}
      disabled={disabled}
      className={classes}
    >
      {children}
    </button>
  )
}
