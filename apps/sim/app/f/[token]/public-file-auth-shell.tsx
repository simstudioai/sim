import type { ReactNode } from 'react'
import { AuthStack } from '@sim/auth-ui'
import { AuthHeader, AuthShell } from '@/app/(auth)/components'

interface PublicFileAuthShellProps {
  title: string
  subtitle: string
  children: ReactNode
}
export function PublicFileAuthShell({ title, subtitle, children }: PublicFileAuthShellProps) {
  return (
    <AuthShell>
      <AuthStack>
        <AuthHeader title={title} description={subtitle} />
        {children}
      </AuthStack>
    </AuthShell>
  )
}
