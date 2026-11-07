import type { HTMLAttributes } from 'react'
import { clsx } from 'clsx'
import styles from '#auth/components/loading/loading.module.css'

interface AuthLoaderProps extends HTMLAttributes<HTMLSpanElement> {
  animate?: boolean
}
/** Decorative spinner with utility-overridable sizing; the loading region owns announcements. */
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
/** Decorative placeholder whose sizing utilities override the shared shape defaults.
 * Controls reserve the mobile touch lane while retaining the compact visible surface. */
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
