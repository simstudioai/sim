'use client'

import type { ReactNode } from 'react'
import { useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from '@sim/emcn/icons'
import { cn } from '@/components/docs/classnames'
import { SidebarNavigation } from '@/components/docs/navigation'
import { useDocsNavigation } from '@/components/docs/navigation-context'
import { docsScrollAreaClass } from '@/components/docs/primitives'
import { DocsSearchTrigger } from '@/components/docs/search'
import { ThemeSwitch } from '@/components/docs/theme'

interface DocsNavigationDrawerProps {
  children: ReactNode
}

/** Keeps drawer navigation state with the shell while its modal content is closed. */
export function DocsNavigationDrawer({ children }: DocsNavigationDrawerProps) {
  const { navigation, pathname } = useDocsNavigation()
  const [drawer, setDrawer] = useState({ pathname, open: false })
  const position = useRef({ navigation, top: 0 })
  if (drawer.pathname !== pathname) setDrawer({ pathname, open: false })
  return (
    <Dialog.Root open={drawer.open} onOpenChange={(open) => setDrawer({ pathname, open })}>
      {children}
      <Dialog.Portal>
        <Dialog.Overlay className='docs-portal fixed inset-0 z-50 bg-[var(--docs-navigation-scrim)] backdrop-blur-[var(--docs-backdrop-blur)]' />
        <Dialog.Content className='docs-portal fixed inset-y-0 left-0 z-50 flex w-[min(340px,100vw-32px)] flex-col border-[var(--docs-border)] border-r bg-[var(--docs-canvas)] p-5 shadow-xl'>
          <div className='mb-5 flex items-center justify-between'>
            <Dialog.Title className='text-docs-nav'>Documentation</Dialog.Title>
            <Dialog.Close
              aria-label='Close navigation'
              className='flex size-11 items-center justify-center rounded-lg hover:bg-[var(--docs-hover)]'
            >
              <X className='size-4' />
            </Dialog.Close>
          </div>
          <Dialog.Description className='sr-only'>
            Browse the current documentation section.
          </Dialog.Description>
          <DocsSearchTrigger />
          <div
            ref={(element) => {
              if (!element || position.current.navigation !== navigation) return
              const top = position.current.top
              const frame = requestAnimationFrame(() => {
                element.scrollTop = top
              })
              return () => cancelAnimationFrame(frame)
            }}
            onScroll={(event) => {
              position.current = { navigation, top: event.currentTarget.scrollTop }
            }}
            className={cn(
              docsScrollAreaClass,
              'mt-5 min-h-0 flex-1 overflow-y-auto overscroll-contain pb-6'
            )}
          >
            <SidebarNavigation
              nodes={navigation}
              pathname={pathname}
              onNavigate={() => setDrawer({ pathname, open: false })}
            />
          </div>
          <ThemeSwitch />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
