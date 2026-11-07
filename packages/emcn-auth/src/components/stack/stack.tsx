import type { ReactNode } from 'react'
import { clsx } from 'clsx'
import styles from '#auth/components/stack/stack.module.css'

interface AuthStackProps {
  children: ReactNode
  className?: string
  gap?: 'section' | 'actions'
}
/** Applies the shared responsive section rhythm; className may adjust layout. */
export function AuthStack({ children, className, gap = 'section' }: AuthStackProps) {
  return (
    <div className={clsx(styles.stack, className)} data-gap={gap}>
      {children}
    </div>
  )
}
/** Pairs provider actions in two columns, with an odd final action spanning both. */
export function AuthProviderGroup({ children, className }: Omit<AuthStackProps, 'gap'>) {
  return <div className={clsx(styles.providers, className)}>{children}</div>
}
