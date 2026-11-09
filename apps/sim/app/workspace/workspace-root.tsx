'use client'

import { SocketProvider } from '@/components/workspace-providers/socket-provider'
import { useSession } from '@/lib/auth/client'
import { connectWorkflowStores } from '@/stores/workflows/state-port/connect-stores'

// The socket provider and chat read workflow state through its port; every workspace page hosts them.
connectWorkflowStores()

interface WorkspaceRootProps {
  children: React.ReactNode
}

/** Joins the realtime socket for every legacy workspace page. */
export function WorkspaceRoot({ children }: WorkspaceRootProps) {
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
