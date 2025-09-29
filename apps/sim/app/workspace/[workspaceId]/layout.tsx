'use client'

import { useSession } from '@/lib/auth-client'
import { SocketProvider } from '@/lib/contexts/socket-context'
import Providers from '@/app/workspace/[workspaceId]/providers/providers'
import { Sidebar } from '@/app/workspace/[workspaceId]/w/components/sidebar/sidebar'

interface WorkspaceLayoutProps {
  children: React.ReactNode
}

export default function WorkspaceLayout({ children }: WorkspaceLayoutProps) {
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
      <Providers>
        <div className='flex min-h-screen w-full'>
          <div className='z-20'>
            <Sidebar />
          </div>
          <div className='flex flex-1 flex-col'>{children}</div>
        </div>
      </Providers>
    </SocketProvider>
  )
}
