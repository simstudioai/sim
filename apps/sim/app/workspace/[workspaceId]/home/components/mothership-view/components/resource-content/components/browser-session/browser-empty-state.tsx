import { Globe } from '@sim/emcn/icons'
import { EmptyState } from '@/components/empty-state/empty-state'

export function BrowserEmptyState() {
  return (
    <section aria-label='New tab' className='absolute inset-0 flex overflow-auto bg-[var(--bg)]'>
      <EmptyState
        graphic={<Globe className='size-5 text-[var(--text-icon)]' aria-hidden='true' />}
        title='Browse the web'
        description='Search or enter a website in the address bar above.'
      />
    </section>
  )
}
