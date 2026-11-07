'use client'

import type { ReactElement, ReactNode } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { Icon } from '@sim/emcn/icon'
import { cn } from '@sim/emcn/lib/cn'
import { docsControlClass, docsDialogClass } from '#docs/components/chrome/chrome'

interface LightboxProps {
  trigger: ReactElement
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
      <Dialog.Trigger render={trigger} />
      <Dialog.Portal>
        <Dialog.Backdrop
          data-emcn=''
          className='docs-portal fixed inset-0 z-50 bg-[var(--docs-media-scrim)] backdrop-blur-[var(--docs-backdrop-blur)]'
        />
        <Dialog.Popup
          data-emcn=''
          className={cn(
            docsDialogClass,
            'fixed inset-3 z-50 flex flex-col overflow-hidden p-4 sm:inset-8'
          )}
        >
          <div className='flex shrink-0 items-center justify-between gap-4 pb-3'>
            <Dialog.Title className='text-docs-table'>{title}</Dialog.Title>
            <Dialog.Close className={docsControlClass} aria-label='Close media viewer'>
              <Icon name='I105' className='size-4' />
            </Dialog.Close>
          </div>
          <Dialog.Description className='sr-only'>{description}</Dialog.Description>
          {children}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
