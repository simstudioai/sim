'use client'

import { BrowseRow, BrowseSection } from '@/app/playground/org/components/browse-rows'
import { isPanelKind, resourcesOfKind } from '@/app/playground/org/lib/chat-resources'
import { RESOURCES, type Workspace } from '@/app/playground/org/lib/mock-data'
import {
  protoRoutes,
  RESOURCE_SECTIONS,
  type WorkspaceSection,
} from '@/app/playground/org/lib/routes'

function countOf(workspace: Workspace, id: WorkspaceSection): number | null {
  if (id === 'credentials') return RESOURCES.credentials.length
  return isPanelKind(id) ? resourcesOfKind(workspace, id).length : null
}

/** The Resources tab: every resource kind as a row, the way the chat panel's new tab lists them. */
export function ResourceKinds({ workspace }: { workspace: Workspace }) {
  return (
    <div className='px-4 py-4'>
      <BrowseSection label={`Browse ${workspace.name}`}>
        {RESOURCE_SECTIONS.map((section) => {
          const count = countOf(workspace, section.id)
          return (
            <BrowseRow key={section.id} href={protoRoutes.workspace(workspace.id, section.id)}>
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
  )
}
