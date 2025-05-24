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
    <div className="p-4 w-60 border-r h-full overflow-auto">
      {/* Show retention policy for free users in production only */}
      {!isLoading && !isPaid && isProd && (
        <div className="mb-4 border border-border rounded-md overflow-hidden">
          <div className="bg-background border-b p-3 flex items-center gap-2">
            <TimerOff className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Log Retention Policy</span>
          </div>
          <div className="p-3">
            <p className="text-xs text-muted-foreground">
              Logs are automatically deleted after 7 days.
            </p>
            <div className="mt-2.5">
              <Button
                size="sm"
                variant="secondary"
                className="px-3 py-1.5 h-8 text-xs w-full"
                onClick={handleUpgradeClick}
              >
                Upgrade Plan
              </Button>
            </div>
          </div>
        </div>
      )}

      <h2 className="text-sm font-medium mb-4 pl-2">Filters</h2>

      {/* Timeline Filter */}
      <FilterSection title="Timeline" defaultOpen={true} content={<Timeline />} />

      {/* Level Filter */}
      <FilterSection title="Level" defaultOpen={true} content={<Level />} />

      {/* Workflow Filter */}
      <FilterSection title="Workflow" defaultOpen={true} content={<Workflow />} />
    </div>
  )
}
