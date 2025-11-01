import type React from 'react'
import { cn } from '@/lib/utils'

interface ConfigSectionProps {
  title?: string
  children: React.ReactNode
  className?: string
}

export function ConfigSection({ title, children, className }: ConfigSectionProps) {
  return (
    <div
      className={cn('space-y-4 rounded-md border border-border bg-card p-4 shadow-sm', className)}
    >
      {children}
    </div>
  )
}
