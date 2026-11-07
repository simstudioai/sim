import type { ReactNode } from 'react'
import { clsx } from 'clsx'
import styles from '#auth/components/tag/tag.module.css'

interface AuthTagProps {
  children: ReactNode
  className?: string
}
/** Presents compact, non-interactive metadata beside Auth content. */
export function AuthTag({ children, className }: AuthTagProps) {
  return <span className={clsx(styles.tag, className)}>{children}</span>
}
