'use client'

import Level from './filter-section/components/level'
import Timeline from './filter-section/components/timeline'
import Workflow from './filter-section/components/workflow'
import FilterSection from './filter-section/filter-section'

/**
 * Filters component for logs page - includes timeline and other filter options
 */
export function Filters() {
  return (
    <div className="p-4 w-64 border-r h-full overflow-auto">
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
