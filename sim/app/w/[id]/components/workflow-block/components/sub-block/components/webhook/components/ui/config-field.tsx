import React from 'react'
import { Label } from '@/components/ui/label'

interface ConfigFieldProps {
  id: string
  label: React.ReactNode // Allow complex labels (e.g., with icons)
  description?: string
  children: React.ReactNode
  className?: string
}

export function ConfigField({ id, label, description, children, className }: ConfigFieldProps) {
  return (
    <div className={`space-y-2 ${className || ''}`}>
      <Label htmlFor={id}>{label}</Label>
      {children} {/* The actual input/select/checkbox goes here */}
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
    </div>
  )
}
