'use client'

import type { ReactNode } from 'react'
import { cn } from '@sim/emcn'
import Link from 'next/link'

const AUTH_TEXT_LINK_CLASS =
  'text-[var(--text-secondary)] underline-offset-4 transition-colors hover:text-[var(--text-primary)] hover:underline disabled:cursor-not-allowed disabled:opacity-50'

interface AuthTextLinkProps {
  children: ReactNode
  /** Renders a navigation link when set; otherwise renders an action button. */
  href?: string
  onClick?: () => void
  /** Opens the link in a new tab with safe `rel` (e.g. Terms/Privacy). */
  external?: boolean
  disabled?: boolean
  className?: string
}

/**
 * The canonical inline text affordance for the auth pages — forgot-password,
 * resend, and the legal links. Renders a {@link Link} when `href` is set and a
 * `<button>` otherwise, both in one light-token style. Replaces the legacy dark
 * `AUTH_TEXT_LINK` class string with a single props-driven source of truth.
 */
export function AuthTextLink({
  children,
  href,
  onClick,
  external = false,
  disabled = false,
  className,
}: AuthTextLinkProps) {
  if (href) {
    return (
      <Link
        href={href}
        onClick={onClick}
        className={cn(AUTH_TEXT_LINK_CLASS, className)}
        {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      >
        {children}
      </Link>
    )
  }

  return (
    <button
      type='button'
      onClick={onClick}
      disabled={disabled}
      className={cn(AUTH_TEXT_LINK_CLASS, className)}
    >
      {children}
    </button>
  )
}
