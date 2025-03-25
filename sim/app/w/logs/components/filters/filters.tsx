'use client'

import FilterSection from './components/filter-section'
import Level from './components/level'
import Timeline from './components/timeline'
import Workflow from './components/workflow'

/**
 * Filters component for logs page - includes timeline and other filter options
 */
export function Filters() {
  return (
    <div className="p-4 w-60 border-r h-full overflow-auto">
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
