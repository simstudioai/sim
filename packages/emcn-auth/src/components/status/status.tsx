import type { ReactNode } from 'react'
import { AuthHeader } from '#auth/components/heading/heading'
import { AuthStack } from '#auth/components/stack/stack'
import styles from '#auth/components/status/status.module.css'

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
    <AuthStack>
      <AuthHeader title={title} titleId={titleId} description={description} />
      {detail}
      {children && <div className={styles.actions}>{children}</div>}
    </AuthStack>
  )
}
