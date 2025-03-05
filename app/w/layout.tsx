import Providers from './components/providers/providers'
import { Sidebar } from './components/sidebar/sidebar'

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      <div className="flex min-h-screen w-full">
        <div className="z-20">
          <Sidebar />
        </div>
        <div className="flex-1 flex flex-col pl-14">{children}</div>
      </div>
    </Providers>
  )
}
