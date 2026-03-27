'use client'

import type { ReactNode } from 'react'
import { Label } from '@/components/emcn'

export interface FormFieldProps {
  label: ReactNode
  children: ReactNode
  htmlFor?: string
  optional?: boolean
  error?: ReactNode
}

/**
 * Standard labeled field wrapper for forms and modals.
 */
export function FormField({ label, children, htmlFor, optional = false, error }: FormFieldProps) {
  return (
    <div className='flex flex-col gap-2'>
      <Label htmlFor={htmlFor}>
        {label}
        {optional ? <span className='ml-1 text-[var(--text-muted)]'>(optional)</span> : null}
      </Label>
      {children}
      {error ? <p className='text-[12px] text-[var(--text-error)]'>{error}</p> : null}
    </div>
  )
}
