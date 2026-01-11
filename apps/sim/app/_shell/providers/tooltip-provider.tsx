'use client'

import { Tooltip } from '@/components/emcn'

interface TooltipProviderProps {
  children: React.ReactNode
}

export function TooltipProvider({ children }: TooltipProviderProps) {
  return <Tooltip.Provider>{children}</Tooltip.Provider>
}
