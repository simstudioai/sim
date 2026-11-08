'use client'

import { type ReactNode, useMemo } from 'react'
import { useSession } from '@/lib/auth/client'
import { SocketProvider } from '@/app/workspace/providers/socket-provider'

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

export { useSocket } from '@/app/workspace/providers/socket-provider'
