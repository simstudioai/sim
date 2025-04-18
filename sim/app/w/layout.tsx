import { ThemeProvider } from '@/components/theme-provider'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Sidebar } from './components/sidebar/sidebar'

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <TooltipProvider delayDuration={100} skipDelayDuration={0}>
        <div className="flex min-h-screen w-full">
          <div className="z-20">
            <Sidebar />
          </div>
          <div className="flex-1 flex flex-col pl-14">{children}</div>
        </div>
      </TooltipProvider>
    </ThemeProvider>
  )
}
