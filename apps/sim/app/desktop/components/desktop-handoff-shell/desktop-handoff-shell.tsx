import type { ReactNode } from 'react'
import { AuthStatusContent } from '@sim/auth-ui'
import { AuthShell } from '@/app/(auth)/components'

interface DesktopHandoffShellProps {
  title: string
  description: ReactNode
  children?: ReactNode
  detail?: ReactNode
}
export function DesktopHandoffShell({
  title,
  description,
  children,
  detail,
}: DesktopHandoffShellProps) {
  return (
    <AuthShell>
      <AuthStatusContent title={title} description={description} detail={detail}>
        {children}
      </AuthStatusContent>
    </AuthShell>
  )
}
