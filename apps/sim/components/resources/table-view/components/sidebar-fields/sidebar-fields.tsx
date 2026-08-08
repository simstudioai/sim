'use client'

import type React from 'react'
import { Label } from '@sim/emcn'

/**
 * Field label with a trailing required marker, matching the sidebar field
 * rhythm shared by the column-config and workflow sidebars.
 */
export function RequiredLabel({
  htmlFor,
  children,
}: {
  htmlFor?: string
  children: React.ReactNode
}) {
  return (
    <Label htmlFor={htmlFor} className='flex items-baseline gap-1.5 whitespace-nowrap pl-0.5'>
      {children}
      <span className='ml-0.5'>*</span>
    </Label>
  )
}

/**
 * Inline validation error rendered under a sidebar field.
 */
export function FieldError({ message }: { message: string }) {
  return <p className='pl-0.5 text-[var(--text-error)] text-caption'>{message}</p>
}
