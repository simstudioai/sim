import type { ReactNode } from 'react'
import styles from '#auth/components/shell/shell.module.css'

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
