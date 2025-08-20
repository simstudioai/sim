'use client'

import { createContext, useContext } from 'react'
import { useSession } from '@/lib/auth-client'
import { SocketProvider } from '@/contexts/socket-context'

interface WorkspaceRootLayoutProps {
  children: React.ReactNode
}

interface SessionUser {
  id: string
  name?: string | null
  email?: string | null
}

interface SessionContextValue {
  user?: SessionUser
}

export const WorkspaceSessionContext = createContext<SessionContextValue>({})
export const useWorkspaceSession = () => useContext(WorkspaceSessionContext)

export default function WorkspaceRootLayout({ children }: WorkspaceRootLayoutProps) {
  const session = useSession()

  const user = session.data?.user
    ? {
        id: session.data.user.id,
        name: session.data.user.name,
        email: session.data.user.email,
      }
    : undefined

  return (
    <WorkspaceSessionContext.Provider value={{ user }}>
      <SocketProvider user={user}>{children}</SocketProvider>
    </WorkspaceSessionContext.Provider>
  )
}
