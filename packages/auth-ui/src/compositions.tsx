import type { ReactNode } from 'react'
import { clsx } from 'clsx'
import { AuthIcon } from './icons'
import styles from './styles.module.css'

interface AuthHeaderProps {
  title: string
  titleId?: string
  description?: ReactNode
}
/** Owns the page heading; description accepts inline content rendered in a paragraph. */
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
/** Connects a label and feedback to a child whose id equals htmlFor.
 * AuthInput with error=true references the generated `${htmlFor}-errors` region.
 * Callers supplying a hint include `${htmlFor}-hint` in the input's aria-describedby. */
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
/** Announces errors as alerts and other feedback as status, without owning validation. */
export function AuthFormMessage({ type, align = 'left', children }: AuthFormMessageProps) {
  return (
    <div
      className={styles.feedback}
      data-align={align}
      data-tone={type}
      role={type === 'error' ? 'alert' : 'status'}
    >
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
/** Separates alternate actions; an omitted label leaves only the divider line. */
export function AuthDivider({ label }: AuthDividerProps) {
  return <div className={styles.divider}>{label && <span>{label}</span>}</div>
}

interface AuthNavPromptProps {
  prompt?: string
  href: string
  linkLabel: string
  onNavigate?: () => void
}
/** Links between Auth routes with full-document navigation; the host preserves return context. */
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
/** Lays out host-supplied branding, navigation, native titlebar, and footer inside AuthRoot.
 * The shared column owns responsive sizing, while the host owns authentication and routing. */
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
/** Composes a status heading, optional detail, and recovery actions in the Auth column. */
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
/** Displays an account identity; the host supplies any account-switch action. */
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
/** Wraps resource details and responsive actions; disabled does not disable child controls. */
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
/** Groups related controls under a section heading without reserving absent description space. */
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
/** Uses host-supplied legal URLs, opening them separately without losing form state. */
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
/** Applies the shared responsive section rhythm; className may adjust layout. */
export function AuthStack({ children, className }: AuthStackProps) {
  return <div className={clsx(styles.stack, className)}>{children}</div>
}
/** Pairs provider actions in two columns, with an odd final action spanning both. */
export function AuthProviderGroup({ children, className }: AuthStackProps) {
  return <div className={clsx(styles.providers, className)}>{children}</div>
}

interface AuthResourceIdentityProps {
  initial: string
  logoUrl?: string | null
}
/** Displays a decorative resource logo or initial beside its accessible name. */
export function AuthResourceIdentity({ initial, logoUrl }: AuthResourceIdentityProps) {
  return (
    <span className={styles.avatar}>
      {logoUrl ? <img src={logoUrl} width='24' height='24' alt='' /> : initial}
    </span>
  )
}
