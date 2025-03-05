'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import FilterSection from './components/filter-section/filter-section'
import Timeline from './components/timeline'

/**
 * Filters component for logs page - includes timeline and other filter options
 */
export function Filters() {
  return (
    <div className="p-4 w-64 border-r h-full overflow-auto">
      <h2 className="text-sm font-medium mb-4 pl-2">Filters</h2>

      {/* Timeline Filter */}
      <FilterSection title="Timeline" defaultOpen={true} content={<Timeline />} />

      {/* Additional filter sections */}
      <FilterSection title="Contains Level" />
      <FilterSection title="Environment" />
      <FilterSection title="Route" />
    </div>
  )
}
