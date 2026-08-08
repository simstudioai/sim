'use client'

import { SocketProvider } from '@/components/socket-provider'
import { useSession } from '@/lib/auth/auth-client'

interface WorkspaceRootLayoutProps {
  children: React.ReactNode
}

export default function WorkspaceRootLayout({ children }: WorkspaceRootLayoutProps) {
  const session = useSession()

  const user = session.data?.user
    ? {
        id: session.data.user.id,
        name: session.data.user.name ?? undefined,
        email: session.data.user.email,
      }
    : undefined

  return (
    <SocketProvider user={user}>
      <div className='workspace-root'>{children}</div>
    </SocketProvider>
  )
}
