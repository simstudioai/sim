'use client'

import {
  FilesEmptyState,
  KnowledgeEmptyState,
  LogsEmptyState,
  SkillsEmptyState,
  TablesEmptyState,
} from '@/app/workspace/[workspaceId]/components/resource/components/resource-empty-state'

const ENTRIES = [
  { label: 'Knowledge', node: <KnowledgeEmptyState onCreate={() => {}} /> },
  { label: 'Tables', node: <TablesEmptyState onCreate={() => {}} /> },
  { label: 'Logs', node: <LogsEmptyState /> },
  { label: 'Files', node: <FilesEmptyState onUpload={() => {}} /> },
  { label: 'Skills', node: <SkillsEmptyState /> },
]

/**
 * Review-only gallery: every resource empty state on one page so the family can
 * be judged side by side. Not linked from the product.
 */
export function ResourceEmptyStateGallery() {
  return (
    <div className='grid grid-cols-2 gap-6 bg-[var(--bg)] p-8'>
      {ENTRIES.map((entry) => (
        <div
          key={entry.label}
          className='flex min-h-[340px] flex-col rounded-[10px] border border-[var(--border-1)] bg-[var(--surface-1)]'
        >
          <p className='border-[var(--border-1)] border-b px-4 py-2 text-[var(--text-muted)] text-small'>
            {entry.label}
          </p>
          <div className='flex min-h-0 flex-1 flex-col'>{entry.node}</div>
        </div>
      ))}
    </div>
  )
}
