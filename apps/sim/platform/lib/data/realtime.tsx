'use client'

import { type ReactNode, useMemo } from 'react'
import { SocketProvider } from '@/components/workspace-providers/socket-provider'
import { useSession } from '@/lib/auth/client'

/**
 * The one realtime socket every live workspace tab shares, connected as the viewer, as the legacy
 * workspace layout mounts it. Workflows, tables, files and knowledge read it with `useSocket`, so
 * moving between tabs keeps the connection and its presence.
 */
export function WorkspaceRealtime({ children }: { children: ReactNode }) {
  const session = useSession()
  const viewer = session.data?.user
  const user = useMemo(
    () =>
      viewer ? { id: viewer.id, name: viewer.name ?? undefined, email: viewer.email } : undefined,
    [viewer]
  )
  return <SocketProvider user={user}>{children}</SocketProvider>
}

export { useSocket } from '@/components/workspace-providers/socket-provider'
