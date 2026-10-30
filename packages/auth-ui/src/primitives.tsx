import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  ComponentType,
  HTMLAttributes,
  LabelHTMLAttributes,
  ReactNode,
} from 'react'
import { clsx } from 'clsx'
import styles from './styles.module.css'

export interface AuthButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?:
    | 'primary'
    | 'secondary'
    | 'outline'
    | 'border'
    | 'ghost'
    | 'default'
    | 'destructive'
    | 'navigation'
  fullWidth?: boolean
  leftIcon?: ComponentType<{ className?: string }>
  rightIcon?: ComponentType<{ className?: string }>
  loading?: boolean
  loadingLabel?: string
}

/** Paper's 32px action inside a separate mobile touch target. */
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

interface AuthLabelProps extends LabelHTMLAttributes<HTMLLabelElement> {}
export function AuthLabel({ className, htmlFor, children, ...props }: AuthLabelProps) {
  return (
    <label {...props} htmlFor={htmlFor} className={clsx(styles.label, className)}>
      {children}
    </label>
  )
}

interface AuthLoaderProps extends HTMLAttributes<HTMLSpanElement> {
  animate?: boolean
}
export function AuthLoader({ className, animate = true, ...props }: AuthLoaderProps) {
  return (
    <span
      {...props}
      aria-hidden='true'
      className={clsx(styles.loader, animate && styles.spinning, className)}
    />
  )
}

interface AuthSkeletonProps extends HTMLAttributes<HTMLSpanElement> {
  shape?: 'title' | 'label' | 'control' | 'divider'
}
export function AuthSkeleton({ className, shape = 'control', ...props }: AuthSkeletonProps) {
  return (
    <span
      {...props}
      aria-hidden='true'
      data-shape={shape}
      className={clsx(styles.skeleton, className)}
    />
  )
}

interface AuthTextLinkProps {
  children: ReactNode
  href?: string
  onClick?: () => void
  external?: boolean
  disabled?: boolean
  className?: string
}
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
      href={href}
      onClick={onClick}
      className={classes}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    >
      {children}
    </a>
  ) : (
    <button type='button' onClick={onClick} disabled={disabled} className={classes}>
      {children}
    </button>
  )
}

interface AuthTagProps {
  children: ReactNode
  className?: string
  variant?: string
}
export function AuthTag({ children, className }: AuthTagProps) {
  return <span className={clsx(styles.tag, className)}>{children}</span>
}
