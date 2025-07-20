'use client'

import { ScrollArea } from '@/components/ui/scroll-area'
import FilterSection from '@/app/workspace/[workspaceId]/logs/components/filters/components/filter-section'
import FolderFilter from '@/app/workspace/[workspaceId]/logs/components/filters/components/folder'
import Level from '@/app/workspace/[workspaceId]/logs/components/filters/components/level'
import Timeline from '@/app/workspace/[workspaceId]/logs/components/filters/components/timeline'
import Trigger from '@/app/workspace/[workspaceId]/logs/components/filters/components/trigger'
import Workflow from '@/app/workspace/[workspaceId]/logs/components/filters/components/workflow'

export function LogsFilters() {
  const sections = [
    { key: 'timeline', title: 'Timeline', component: <Timeline /> },
    { key: 'level', title: 'Level', component: <Level /> },
    { key: 'trigger', title: 'Trigger', component: <Trigger /> },
    { key: 'folder', title: 'Folder', component: <FolderFilter /> },
    { key: 'workflow', title: 'Workflow', component: <Workflow /> },
  ]

  return (
    <div className='h-full'>
      <ScrollArea className='h-full' hideScrollbar={true}>
        <div className='space-y-4 px-3 py-3'>
          {sections.map((section) => (
            <FilterSection key={section.key} title={section.title} content={section.component} />
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}
