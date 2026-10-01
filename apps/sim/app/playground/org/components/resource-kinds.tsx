'use client'

import { Folder } from '@sim/emcn/icons'
import { BrowseRow, BrowseSection } from '@/app/playground/org/components/browse-rows'
import { isPanelKind, resourcesOfKind } from '@/app/playground/org/lib/chat-resources'
import { RESOURCES, type Workspace } from '@/app/playground/org/lib/mock-data'
import { RESOURCE_SECTIONS, type WorkspaceSection } from '@/app/playground/org/lib/routes'
import { useWorkspacePane } from '@/app/playground/org/lib/workspace-pane-store'
import { ResourceHeader } from '@/app/workspace/[workspaceId]/components/resource/components/resource-header'

function countOf(workspace: Workspace, id: WorkspaceSection): number | null {
  if (id === 'credentials') return RESOURCES.credentials.length
  return isPanelKind(id) ? resourcesOfKind(workspace, id).length : null
}

/** The Resources tab: the same header bar the kind lists carry, over every kind as a row. */
export function ResourceKinds({ workspace }: { workspace: Workspace }) {
  const setSection = useWorkspacePane((state) => state.setSection)
  return (
    <div className='flex h-full min-h-0 flex-col'>
      <ResourceHeader icon={Folder} title='Resources' />
      <div className='min-h-0 flex-1 overflow-y-auto px-4 py-4'>
        <BrowseSection label={`Browse ${workspace.name}`}>
          {RESOURCE_SECTIONS.map((section) => {
            const count = countOf(workspace, section.id)
            return (
              <BrowseRow key={section.id} onClick={() => setSection(section.id)}>
                <section.icon className='size-[14px] shrink-0 text-[var(--text-icon)]' />
                <span className='min-w-0 flex-1 truncate text-[var(--text-body)]'>
                  {section.label}
                </span>
                {count !== null && (
                  <span className='text-[var(--text-muted)] text-caption'>{count}</span>
                )}
              </BrowseRow>
            )
          })}
        </BrowseSection>
      </div>
    </div>
  )
}
