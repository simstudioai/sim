'use client'

import { ScrollArea } from '@/components/ui/scroll-area'
import FilterSection from '@/app/workspace/[workspaceId]/logs/components/filters/components/filter-section'
import FolderFilter from '@/app/workspace/[workspaceId]/logs/components/filters/components/folder'
import Level from '@/app/workspace/[workspaceId]/logs/components/filters/components/level'
import Timeline from '@/app/workspace/[workspaceId]/logs/components/filters/components/timeline'
import Trigger from '@/app/workspace/[workspaceId]/logs/components/filters/components/trigger'
import Workflow from '@/app/workspace/[workspaceId]/logs/components/filters/components/workflow'
import { useFilterStore } from '@/stores/logs/filters/store'

export function LogsFilters() {
  const viewMode = useFilterStore((state) => state.viewMode)

  const sections = [
    { key: 'level', title: 'Level', component: <Level />, showInDashboard: false },
    { key: 'workflow', title: 'Workflow', component: <Workflow />, showInDashboard: true },
    { key: 'folder', title: 'Folder', component: <FolderFilter />, showInDashboard: true },
    { key: 'trigger', title: 'Trigger', component: <Trigger />, showInDashboard: true },
    { key: 'timeline', title: 'Timeline', component: <Timeline />, showInDashboard: true },
  ]

  const filteredSections =
    viewMode === 'dashboard' ? sections.filter((section) => section.showInDashboard) : sections

  return (
    <div className='h-full'>
      <ScrollArea className='h-full' hideScrollbar={true}>
        <div className='space-y-4 px-3 py-3'>
          {filteredSections.map((section) => (
            <FilterSection key={section.key} title={section.title} content={section.component} />
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}
