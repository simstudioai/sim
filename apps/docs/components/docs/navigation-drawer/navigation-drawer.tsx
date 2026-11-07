'use client'

import {
  type ComponentProps,
  createContext,
  type ReactNode,
  useContext,
  useRef,
  useState,
} from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { Icon } from '@sim/emcn/icon'
import { cn } from '@sim/emcn/lib/cn'
import { useScrollEdges } from '@sim/emcn/scroll-area/use-scroll-edges'
import { docsScrollAreaClass } from '@sim/emcn-docs/chrome'
import { SidebarNavigation } from '@/components/docs/navigation/navigation'
import { useDocsNavigation } from '@/components/docs/navigation-context/navigation-context'
import { DocsSearchTrigger } from '@/components/docs/search/search'
import { ThemeSwitch } from '@/components/docs/theme/theme'

const DrawerHandleContext = createContext<ReturnType<typeof Dialog.createHandle> | null>(null)

interface DocsNavigationTriggerProps extends ComponentProps<'button'> {}

/** Connects the page toolbar to its detached navigation dialog. */
export function DocsNavigationTrigger(props: DocsNavigationTriggerProps) {
  const handle = useContext(DrawerHandleContext)
  if (!handle) throw new Error('DocsNavigationTrigger requires DocsNavigationDrawer')
  return <Dialog.Trigger handle={handle} {...props} />
}

interface DocsNavigationDrawerProps {
  children: ReactNode
}

/** Keeps drawer navigation state with the shell while its modal content is closed. */
export function DocsNavigationDrawer({ children }: DocsNavigationDrawerProps) {
  const [handle] = useState(() => Dialog.createHandle())
  const scrollRef = useScrollEdges()
  const { navigation, pathname } = useDocsNavigation()
  const [drawer, setDrawer] = useState({ pathname, open: false })
  const position = useRef({ navigation, top: 0 })
  if (drawer.pathname !== pathname) setDrawer({ pathname, open: false })
  return (
    <DrawerHandleContext value={handle}>
      {children}
      <Dialog.Root
        handle={handle}
        open={drawer.open}
        onOpenChange={(open) => setDrawer({ pathname, open })}
      >
        <Dialog.Portal>
          <Dialog.Backdrop
            data-emcn=''
            className='docs-portal fixed inset-0 z-50 bg-[var(--docs-navigation-scrim)] backdrop-blur-[var(--docs-backdrop-blur)]'
          />
          <Dialog.Popup
            data-emcn=''
            className='docs-portal fixed inset-y-0 left-0 z-50 flex w-[min(340px,100vw-32px)] flex-col border-[var(--docs-border)] border-r bg-[var(--docs-canvas)] p-5 shadow-xl'
          >
            <div className='mb-5 flex items-center justify-between'>
              <Dialog.Title className='text-docs-nav'>Documentation</Dialog.Title>
              <Dialog.Close
                aria-label='Close navigation'
                className='flex size-11 items-center justify-center rounded-lg hover:bg-[var(--docs-hover)]'
              >
                <Icon name='I105' className='size-4' />
              </Dialog.Close>
            </div>
            <Dialog.Description className='sr-only'>
              Browse the current documentation section.
            </Dialog.Description>
            <DocsSearchTrigger />
            <div
              ref={(element) => {
                const cleanup = scrollRef(element)
                if (!element || position.current.navigation !== navigation) return cleanup
                const top = position.current.top
                const frame = requestAnimationFrame(() => {
                  element.scrollTop = top
                })
                return () => {
                  cancelAnimationFrame(frame)
                  cleanup?.()
                }
              }}
              onScroll={(event) => {
                position.current = { navigation, top: event.currentTarget.scrollTop }
              }}
              className={cn(
                docsScrollAreaClass,
                '-mx-1 mt-5 min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-1 pb-6'
              )}
            >
              <SidebarNavigation
                nodes={navigation}
                pathname={pathname}
                onNavigate={() => setDrawer({ pathname, open: false })}
              />
            </div>
            <ThemeSwitch />
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </DrawerHandleContext>
  )
}
