import React from 'react'

interface ConfigSectionProps {
  title?: string
  children: React.ReactNode
  className?: string
}

export function ConfigSection({ title, children, className }: ConfigSectionProps) {
  return (
    <div className={`space-y-4 rounded-md border border-border bg-card p-4 ${className}`}>
      {title && <h3 className="text-lg font-semibold mb-4">{title}</h3>}
      {children}
    </div>
  )
}
