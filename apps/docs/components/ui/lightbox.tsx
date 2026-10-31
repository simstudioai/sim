'use client'

import type { ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from '@sim/emcn/icons'
import { cn } from '@/components/docs/classnames'
import { docsControlClass, docsDialogClass } from '@/components/docs/primitives'

interface LightboxProps {
  trigger: ReactNode
  title: string
  description: string
  children: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

/** Shared modal geometry and keyboard behavior for documentation media. */
export function Lightbox({
  trigger,
  title,
  description,
  children,
  open,
  onOpenChange,
}: LightboxProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className='docs-portal fixed inset-0 z-50 bg-[var(--docs-media-scrim)] backdrop-blur-[var(--docs-backdrop-blur)]' />
        <Dialog.Content
          className={cn(
            docsDialogClass,
            'fixed inset-3 z-50 flex flex-col overflow-hidden p-4 sm:inset-8'
          )}
        >
          <div className='flex shrink-0 items-center justify-between gap-4 pb-3'>
            <Dialog.Title className='text-docs-table'>{title}</Dialog.Title>
            <Dialog.Close className={docsControlClass} aria-label='Close media viewer'>
              <X className='size-4' />
            </Dialog.Close>
          </div>
          <Dialog.Description className='sr-only'>{description}</Dialog.Description>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
