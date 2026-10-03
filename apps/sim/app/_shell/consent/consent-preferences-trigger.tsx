'use client'

import type { ReactNode } from 'react'
import { useHeadlessConsentUI } from '@c15t/nextjs/headless'
import { Button, cn } from '@sim/emcn'

interface ConsentPreferencesTriggerProps {
  children: ReactNode
  className?: string
}

export function ConsentPreferencesTrigger({ children, className }: ConsentPreferencesTriggerProps) {
  const { openDialog } = useHeadlessConsentUI()

  return (
    <Button
      type='button'
      variant='ghost-secondary'
      className={cn('h-auto justify-start p-0 text-[length:inherit]', className)}
      onClick={openDialog}
    >
      {children}
    </Button>
  )
}
