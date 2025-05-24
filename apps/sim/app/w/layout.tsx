import Providers from './components/providers/providers'
import { Sidebar } from './components/sidebar/sidebar'

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      <div className='flex min-h-screen w-full'>
        <div className='z-20'>
          <Sidebar />
        </div>
        <div className='flex flex-1 flex-col'>{children}</div>
      </div>
    </Providers>
  )
}
