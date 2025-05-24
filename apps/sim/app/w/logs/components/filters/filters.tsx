'use client'

import { TimerOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { isProd } from '@/lib/environment'
import { useUserSubscription } from '@/hooks/use-user-subscription'
import FilterSection from './components/filter-section'
import Level from './components/level'
import Timeline from './components/timeline'
import Workflow from './components/workflow'

/**
 * Filters component for logs page - includes timeline and other filter options
 */
export function Filters() {
  const { isPaid, isLoading } = useUserSubscription()

  const handleUpgradeClick = (e: React.MouseEvent) => {
    e.preventDefault()
    const event = new CustomEvent('open-settings', {
      detail: { tab: 'subscription' },
    })
    window.dispatchEvent(event)
  }

  return (
    <div className='h-full w-60 overflow-auto border-r p-4'>
      {/* Show retention policy for free users in production only */}
      {!isLoading && !isPaid && isProd && (
        <div className='mb-4 overflow-hidden rounded-md border border-border'>
          <div className='flex items-center gap-2 border-b bg-background p-3'>
            <TimerOff className='h-4 w-4 text-muted-foreground' />
            <span className='font-medium text-sm'>Log Retention Policy</span>
          </div>
          <div className='p-3'>
            <p className='text-muted-foreground text-xs'>
              Logs are automatically deleted after 7 days.
            </p>
            <div className='mt-2.5'>
              <Button
                size='sm'
                variant='secondary'
                className='h-8 w-full px-3 py-1.5 text-xs'
                onClick={handleUpgradeClick}
              >
                Upgrade Plan
              </Button>
            </div>
          </div>
        </div>
      )}

      <h2 className='mb-4 pl-2 font-medium text-sm'>Filters</h2>

      {/* Timeline Filter */}
      <FilterSection title='Timeline' defaultOpen={true} content={<Timeline />} />

      {/* Level Filter */}
      <FilterSection title='Level' defaultOpen={true} content={<Level />} />

      {/* Workflow Filter */}
      <FilterSection title='Workflow' defaultOpen={true} content={<Workflow />} />
    </div>
  )
}
