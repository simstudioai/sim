'use client'

import { ChevronDown } from 'lucide-react'
import { Button, Popover, PopoverAnchor, PopoverContent, PopoverItem } from '@/components/emcn'
import {
  KnowledgeBaseCardSkeletonGrid,
  KnowledgeHeader,
  SearchInput,
} from '@/app/workspace/[workspaceId]/knowledge/components'
import {
  filterButtonClass,
  SORT_OPTIONS,
} from '@/app/workspace/[workspaceId]/knowledge/components/shared'

export default function KnowledgeLoading() {
  const breadcrumbs = [{ id: 'knowledge', label: 'Knowledge' }]
  const currentSortLabel = SORT_OPTIONS[0]?.label || 'Last Updated'

  return (
    <div className='flex h-screen flex-col pl-64'>
      {/* Header */}
      <KnowledgeHeader breadcrumbs={breadcrumbs} />

      <div className='flex flex-1 overflow-hidden'>
        <div className='flex flex-1 flex-col overflow-hidden'>
          {/* Main Content */}
          <div className='flex-1 overflow-auto'>
            <div className='px-6 pb-6'>
              {/* Search and Create Section */}
              <div className='mb-4 flex items-center justify-between pt-1'>
                <SearchInput
                  value=''
                  onChange={() => {}}
                  placeholder='Search knowledge bases...'
                  disabled
                />

                <div className='flex items-center gap-2'>
                  {/* Sort Dropdown */}
                  <Popover open={false}>
                    <PopoverAnchor asChild>
                      <Button variant='outline' className={filterButtonClass} disabled>
                        {currentSortLabel}
                        <ChevronDown className='ml-2 h-4 w-4 text-muted-foreground' />
                      </Button>
                    </PopoverAnchor>
                    <PopoverContent align='end' side='bottom' sideOffset={4}>
                      {SORT_OPTIONS.map((option) => (
                        <PopoverItem key={option.value} disabled>
                          {option.label}
                        </PopoverItem>
                      ))}
                    </PopoverContent>
                  </Popover>

                  {/* Create Button */}
                  <Button disabled variant='primary' className='flex items-center gap-1'>
                    <div className='h-3.5 w-3.5 animate-pulse rounded bg-primary-foreground/30' />
                    <span>Create</span>
                  </Button>
                </div>
              </div>

              {/* Content Area */}
              <KnowledgeBaseCardSkeletonGrid count={8} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
