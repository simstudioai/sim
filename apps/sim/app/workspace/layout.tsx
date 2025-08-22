'use client'

import { useSession } from '@/lib/auth-client'
import { SocketProvider } from '@/contexts/socket-context'

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

  return <SocketProvider user={user}>{children}</SocketProvider>
}
