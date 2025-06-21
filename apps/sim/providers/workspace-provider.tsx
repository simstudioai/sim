'use client'

import type { ReactNode } from 'react'
import { useSession } from '@/lib/auth-client'
import { SocketProvider } from '@/contexts/socket-context'

interface WorkspaceProviderProps {
  children: ReactNode
}

export function WorkspaceProvider({ children }: WorkspaceProviderProps) {
  const session = useSession()

  const user = session.data?.user
    ? {
        id: session.data.user.id,
        name: session.data.user.name,
        email: session.data.user.email,
      }
    : undefined

  return <SocketProvider user={user}>{children}</SocketProvider>
}
