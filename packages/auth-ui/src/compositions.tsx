import type { ReactNode } from 'react'
import { clsx } from 'clsx'
import { AuthIcon } from './icons'
import styles from './styles.module.css'

interface AuthHeaderProps {
  title: string
  titleId?: string
  description?: ReactNode
}
export function AuthHeader({ title, titleId, description }: AuthHeaderProps) {
  return (
    <div className={styles.heading}>
      <h1 id={titleId}>{title}</h1>
      {description != null && <p>{description}</p>}
    </div>
  )
}

interface AuthFieldProps {
  htmlFor: string
  label: string
  errors?: string[]
  hint?: ReactNode
  action?: ReactNode
  children: ReactNode
}
export function AuthField({ htmlFor, label, errors, hint, action, children }: AuthFieldProps) {
  return (
    <div className={styles.field}>
      <div className={styles.labelRow}>
        <label className={styles.label} htmlFor={htmlFor}>
          {label}
        </label>
        {action}
      </div>
      {children}
      {hint && (
        <div id={`${htmlFor}-hint`} className={styles.caption}>
          {hint}
        </div>
      )}
      {Boolean(errors?.length) && (
        <div id={`${htmlFor}-errors`} className={styles.fieldErrors} aria-live='polite'>
          {errors?.map((error) => (
            <p key={error}>{error}</p>
          ))}
        </div>
      )}
    </div>
  )
}

interface AuthFormMessageProps {
  type: 'error' | 'success' | 'info'
  align?: 'left' | 'center'
  children: ReactNode
}
export function AuthFormMessage({ type, children }: AuthFormMessageProps) {
  return (
    <div className={styles.feedback} data-tone={type} role={type === 'error' ? 'alert' : 'status'}>
      <span className={styles.feedbackIcon}>
        <AuthIcon name={type === 'error' ? 'error' : 'check'} />
      </span>
      <div>{children}</div>
    </div>
  )
}

interface AuthDividerProps {
  label?: string
}
export function AuthDivider({ label }: AuthDividerProps) {
  return <div className={styles.divider}>{label && <span>{label}</span>}</div>
}

interface AuthNavPromptProps {
  prompt?: string
  href: string
  linkLabel: string
  onNavigate?: () => void
}
export function AuthNavPrompt({ prompt, href, linkLabel, onNavigate }: AuthNavPromptProps) {
  return (
    <div className={styles.navPrompt}>
      {prompt && <span>{prompt}</span>}
      <a href={href} onClick={onNavigate}>
        {linkLabel}
      </a>
    </div>
  )
}

interface AuthShellViewProps {
  children: ReactNode
  logo: ReactNode
  homeHref: string
  navigation?: ReactNode
  footer?: ReactNode
  titlebar?: ReactNode
}
export function AuthShellView({
  children,
  logo,
  homeHref,
  navigation,
  footer,
  titlebar,
}: AuthShellViewProps) {
  return (
    <div className={styles.page}>
      {titlebar}
      <header className={styles.header}>
        <nav className={styles.nav} aria-label='Authentication'>
          <a className={styles.wordmark} href={homeHref} aria-label='Home'>
            {logo}
          </a>
          {navigation}
        </nav>
      </header>
      <main className={styles.main}>
        <div className={styles.column}>{children}</div>
      </main>
      {footer && <footer className={styles.footer}>{footer}</footer>}
    </div>
  )
}

interface AuthStatusContentProps {
  title: string
  titleId?: string
  description?: ReactNode
  detail?: ReactNode
  children?: ReactNode
}
export function AuthStatusContent({
  title,
  titleId,
  description,
  detail,
  children,
}: AuthStatusContentProps) {
  return (
    <div className={styles.stack}>
      <AuthHeader title={title} titleId={titleId} description={description} />
      {detail}
      {children && <div className={styles.actions}>{children}</div>}
    </div>
  )
}

interface AuthIdentityProps {
  email: string
  name?: string
  label?: string
  action?: ReactNode
}
export function AuthIdentity({ email, name, label = 'Signed in as', action }: AuthIdentityProps) {
  return (
    <div className={styles.identity}>
      <span className={styles.avatar} aria-hidden='true'>
        {(name || email).slice(0, 1).toUpperCase()}
      </span>
      <div className={styles.identityText}>
        <p>{name || label}</p>
        <p>{email}</p>
      </div>
      {action}
    </div>
  )
}

interface AuthResourceRowProps {
  icon?: ReactNode
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  className?: string
  disabled?: boolean
}
export function AuthResourceRow({
  icon,
  title,
  description,
  actions,
  children,
  className,
  disabled,
}: AuthResourceRowProps) {
  return (
    <div className={clsx(styles.resourceRow, className)} aria-disabled={disabled || undefined}>
      <div className={styles.resourceIcon}>{icon}</div>
      <div className={styles.resourceText}>
        <div>{title}</div>
        {description && <p>{description}</p>}
        {children}
      </div>
      {actions && <div className={styles.resourceActions}>{actions}</div>}
    </div>
  )
}

interface AuthSectionProps {
  title: string
  children: ReactNode
  className?: string
  description?: ReactNode
}
export function AuthSection({ title, children, className, description }: AuthSectionProps) {
  return (
    <section className={clsx(styles.stack, className)}>
      <div className={styles.sectionHeading}>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      <div>{children}</div>
    </section>
  )
}

interface AuthLegalProps {
  action: string
  termsHref: string
  privacyHref: string
}
export function AuthLegal({ action, termsHref, privacyHref }: AuthLegalProps) {
  return (
    <p className={styles.legal}>
      By {action}, you agree to our{' '}
      <a href={termsHref} target='_blank' rel='noopener noreferrer'>
        Terms of Service
      </a>{' '}
      and{' '}
      <a href={privacyHref} target='_blank' rel='noopener noreferrer'>
        Privacy&nbsp;Policy
      </a>
      .
    </p>
  )
}

interface AuthStackProps {
  children: ReactNode
  className?: string
}
export function AuthStack({ children, className }: AuthStackProps) {
  return <div className={clsx(styles.stack, className)}>{children}</div>
}
export function AuthProviderGroup({ children, className }: AuthStackProps) {
  return <div className={clsx(styles.providers, className)}>{children}</div>
}

interface AuthResourceIdentityProps {
  initial: string
  logoUrl?: string | null
}
export function AuthResourceIdentity({ initial, logoUrl }: AuthResourceIdentityProps) {
  return (
    <span className={styles.avatar}>
      {logoUrl ? <img src={logoUrl} width='24' height='24' alt='' /> : initial}
    </span>
  )
}
