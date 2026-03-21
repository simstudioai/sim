import { StudioSidebar } from '@/app/(landing)/blog/sidebar'

export function WithSidebar({ children }: { children: React.ReactNode }) {
  return (
    <div className='flex flex-1 flex-col lg:flex-row'>
      <StudioSidebar />
      <main className='relative flex-1'>{children}</main>
    </div>
  )
}
