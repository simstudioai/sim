import { type ComponentType, StrictMode, useState } from 'react'
import { Chip, ChipInput, ToastProvider, toast } from '@sim/emcn'
import { PathnameContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime'
import { createRoot } from 'react-dom/client'

interface UpdateNotificationFixtureProps {
  Notification: ComponentType
}

function UpdateNotificationFixture({ Notification }: UpdateNotificationFixtureProps) {
  const [pathname, setPathname] = useState('/workspace/first')
  return (
    <PathnameContext.Provider value={pathname}>
      <ToastProvider>
        <Notification />
        <main className='flex flex-col gap-[16px] p-[48px]'>
          <ChipInput aria-label='Work in progress' placeholder='Keep working' />
          <Chip onClick={() => setPathname('/workspace/second')}>Switch workspace</Chip>
          <Chip
            onClick={() => {
              for (let index = 0; index < 3; index++) {
                toast({ message: `Background task ${index + 1}`, duration: 0 })
              }
            }}
          >
            Fill notification stack
          </Chip>
          <Chip onClick={() => toast.dismissAll()}>Clear notifications</Chip>
          <output aria-label='Current route'>{pathname}</output>
        </main>
      </ToastProvider>
    </PathnameContext.Provider>
  )
}

/** Supplies the production notification through Sim's module aliases. */
export function mountUpdateNotificationFixture(Notification: ComponentType) {
  const root = document.getElementById('root')
  if (!root) throw new Error('Missing fixture root')
  createRoot(root).render(
    <StrictMode>
      <UpdateNotificationFixture Notification={Notification} />
    </StrictMode>
  )
}
