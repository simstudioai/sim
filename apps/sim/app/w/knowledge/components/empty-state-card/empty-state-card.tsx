'use client'

import { LibraryBig } from 'lucide-react'

interface EmptyStateCardProps {
  title: string
  description: string
  buttonText: string
  onClick: () => void
  icon?: React.ReactNode
}

export function EmptyStateCard({
  title,
  description,
  buttonText,
  onClick,
  icon,
}: EmptyStateCardProps) {
  return (
    <div
      onClick={onClick}
      className="group flex flex-col gap-3 rounded-md border border-dashed border-muted-foreground/25 bg-background p-4 transition-colors hover:bg-accent/50 hover:border-muted-foreground/40 cursor-pointer"
    >
      <div className="flex items-center gap-2">
        {icon || (
          <LibraryBig className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        )}
        <h3 className="font-medium text-sm leading-tight truncate">{title}</h3>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Get started</span>
        </div>

        <p className="text-xs text-muted-foreground line-clamp-2 overflow-hidden">
          {description}
        </p>
      </div>
    </div>
  )
}
