import type { ReactNode } from 'react'
import styles from '#auth/components/identity/identity.module.css'

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
      <AuthIdentityContent email={email} name={name} label={label} />
      {action}
    </div>
  )
}

interface AuthIdentityContentProps extends Omit<AuthIdentityProps, 'action'> {}

/** Shared account anatomy for a static identity and the account-switch trigger. */
export function AuthIdentityContent({ email, name, label }: AuthIdentityContentProps) {
  return (
    <>
      <span className={styles.avatar} aria-hidden='true'>
        {(name || email).slice(0, 1).toUpperCase()}
      </span>
      <span className={styles.identityText}>
        <span>{name || label}</span>
        <span className={styles.email}>{email}</span>
      </span>
    </>
  )
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
