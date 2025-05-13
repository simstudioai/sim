'use client'

import { InfoIcon } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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

  return (
    <div className="p-4 w-60 border-r h-full overflow-auto">
      {/* Show retention policy for free users */}
      {!isLoading && !isPaid && (
        <Alert className="mb-4">
          <InfoIcon className="h-4 w-4" />
          <AlertTitle>Log Retention Policy</AlertTitle>
          <AlertDescription className="text-xs">
            Logs are automatically deleted after 7 days. Upgrade to a paid plan for unlimited log
            retention.
          </AlertDescription>
        </Alert>
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
