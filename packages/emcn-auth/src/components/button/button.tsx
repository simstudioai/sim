import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ComponentType } from 'react'
import { clsx } from 'clsx'
import styles from '#auth/components/button/button.module.css'
import { AuthLoader } from '#auth/components/loading/loading'

export interface AuthButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'navigation'
  fullWidth?: boolean
  leftIcon?: ComponentType<{ className?: string }>
  rightIcon?: ComponentType<{ className?: string }>
  loading?: boolean
  loadingLabel?: string
}

/** A compact 32px action inside a separate mobile touch target. */
export function AuthButton({
  children,
  className,
  variant = 'secondary',
  fullWidth,
  leftIcon: Icon,
  rightIcon: EndIcon,
  loading,
  loadingLabel,
  disabled,
  type = 'button',
  ...props
}: AuthButtonProps) {
  return (
    <button
      {...props}
      type={type}
      className={clsx(styles.button, fullWidth && styles.fullWidth, className)}
      data-variant={variant}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      <span className={styles.buttonSurface}>
        {loading ? <AuthLoader /> : Icon ? <Icon className={styles.icon} /> : null}
        <span>{loading ? (loadingLabel ?? children) : children}</span>
        {!loading && EndIcon && <EndIcon className={styles.icon} />}
      </span>
    </button>
  )
}

export interface AuthLinkButtonProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  variant?: AuthButtonProps['variant']
  fullWidth?: boolean
}

/** Applies Auth action styling to a native link without introducing client routing. */
export function AuthLinkButton({
  className,
  children,
  variant = 'secondary',
  fullWidth,
  ...props
}: AuthLinkButtonProps) {
  return (
    <a
      {...props}
      className={clsx(styles.button, fullWidth && styles.fullWidth, className)}
      data-variant={variant}
    >
      <span className={styles.buttonSurface}>{children}</span>
    </a>
  )
}
