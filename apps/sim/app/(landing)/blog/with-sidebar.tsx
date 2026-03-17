import { StudioSidebar } from '@/app/(landing)/blog/sidebar'

interface WithSidebarProps {
  children: React.ReactNode
  activeTag?: string | null
}

export function WithSidebar({ children, activeTag }: WithSidebarProps) {
  return (
    <div className='flex flex-1 flex-col lg:flex-row'>
      <StudioSidebar activeTag={activeTag} />
      <main className='relative flex-1'>{children}</main>
    </div>
  )
}
