'use client'

import { TooltipProvider } from '@/components/ui/tooltip'
import { ThemeProvider } from './theme-provider'

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <TooltipProvider delayDuration={100} skipDelayDuration={0}>
        {children}
      </TooltipProvider>
    </ThemeProvider>
  )
}
