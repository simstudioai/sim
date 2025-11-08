import Providers from '@/app/workspace/[workspaceId]/providers/providers'
import { SidebarNew } from '@/app/workspace/[workspaceId]/w/components/sidebar/sidebar-new'

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      <div className='flex min-h-screen w-full'>
        <SidebarNew />
        <div className='flex flex-1 flex-col'>{children}</div>
      </div>
    </Providers>
  )
}
