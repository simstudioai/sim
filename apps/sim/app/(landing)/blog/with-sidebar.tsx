import { StudioSidebar } from '@/app/(landing)/blog/sidebar'

interface WithSidebarProps {
  children: React.ReactNode
  activeTag?: string | null
}

export function WithSidebar({ children, activeTag }: WithSidebarProps) {
  return (
    <div className='flex min-h-0 flex-1 flex-col lg:flex-row'>
      <StudioSidebar activeTag={activeTag} />
      <main className='relative min-w-0 flex-1'>{children}</main>
    </div>
  )
}
